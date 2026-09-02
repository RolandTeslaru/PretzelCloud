import { Injectable, Logger } from '@nestjs/common';
import { Fleet, Plan, Workspace } from '@pretzel-cloud/shared/domain';
import { Provisioning } from '@pretzel-cloud/shared/domain/Workspace/provisioning';
import { FleetDB } from '@/db/fleet';
import { Principal } from '@/auth/identity/principal';
import { DriverRegistry } from '../drivers/driver.registry';
import { MachineService } from '../Machine/machine.service';
import { MachineRepository } from '../Machine/machine.repository';
import { HardwareRepository } from './hardware.repository';
import { ClusterService } from '../cluster/cluster.service';
import { ReleaseService } from '../Release/release.service';
import { HardwareLifecycleService } from './lifecycle.service';
import { HardwareStateService } from './state.service';
import { HardwareStatisticsService } from './statistics.service';

const describe = (error: unknown) => error instanceof Error ? error.message : String(error);

/** A conversion failed and could not rebuild what it took apart, leaving the workspace with no machines. */
export class TopologyNotRestored extends Error {

    constructor(
        public readonly workspaceId:     Workspace.Id,
        public readonly conversionError: unknown,
        public readonly restoreError:    unknown,
    ) {
        super(
            `${workspaceId} has no machines: converting failed (${describe(conversionError)}) `
            + `and rebuilding what it had failed too (${describe(restoreError)})`,
        );
    }
}

/**
 * A workspace's compute as one thing: what it is allocated and what shape it takes.
 * Driving it and reading it are the sub-services hung off this one.
 */
@Injectable()
export class HardwareService {

    private readonly logger = new Logger(HardwareService.name);

    constructor(
        private readonly repository:        HardwareRepository,
        private readonly driverRegistry:    DriverRegistry,
        private readonly machineService:    MachineService,
        private readonly machineRepository: MachineRepository,
        private readonly clusterService:    ClusterService,
        private readonly releaseService:    ReleaseService,

        public readonly lifecycle:  HardwareLifecycleService,
        public readonly state:      HardwareStateService,
        public readonly statistics: HardwareStatisticsService,
    ) {}




    /**
     * The platform, the cluster, and the workspace's own database on it. Idempotent — the row
     * is written before the database it names. The returned URL carries the password, minted here.
     */
    async provision(workspaceId: Workspace.Id): Promise<Fleet.Cluster.Database.ConnectionURL> {
        const cluster = await this.clusterService.getClusterForNewWorkspace();

        const driverKind = this.driverRegistry.getKindForNewWorkspaces()

        const release = await this.releaseService.getLatest();

        if (!release)
            throw new Error('No release to build workspaces from');

        await this.repository.ensureForWorkspace(Principal.SELF, workspaceId, driverKind, cluster.id, release.id);

        return this.clusterService.createDatabase(
            cluster,
            Provisioning.getDatabaseName(workspaceId),
            Provisioning.getRoleName(workspaceId),
        );
    }




    /** The row, or a throw — everything below needs hardware allocated first. */
    async getHardware(workspaceId: Workspace.Id): Promise<FleetDB.Hardware.Row> {
        const hardware = await this.repository.getByWorkspace(Principal.SELF, workspaceId);

        if (!hardware)
            throw new Error(`${workspaceId} has no hardware`);

        return hardware;
    }




    /** The machines the plan calls for; the caller never names roles. */
    async assemble(
        workspaceId:    Workspace.Id,
        plan:           Plan,
        baseEnvKeys:    Fleet.Machine.EnvKeys.Base,
        backendEnvKeys: Fleet.Machine.EnvKeys.Backend,
    ): Promise<void> {
        const machineRoles = Plan.getMachineRoles(plan);

        await this.buildCompute(workspaceId, plan, machineRoles, baseEnvKeys, backendEnvKeys, null);
    }




    /**
     * Creates roles in bring-up order, so a worker is built from a backend address that exists.
     * Plan and roles are given separately: the plan decides sizes, the roles decide shape.
     */
    private async buildCompute(
        workspaceId:    Workspace.Id,
        plan:           Plan,
        machineRoles:   Fleet.Machine.Role[],
        baseEnvKeys:    Fleet.Machine.EnvKeys.Base,
        backendEnvKeys: Fleet.Machine.EnvKeys.Backend,
        backendHost:    string | null,
    ): Promise<void> {
        const hardware = await this.getHardware(workspaceId);

        const driver = this.driverRegistry.getDriverForKind(hardware.driver);

        const release = await this.releaseService.getById(hardware.release_id);

        const ordered = Fleet.Machine.inLifecycleOrder('start', machineRoles.map((role) => ({ role })));

        for (const { role } of ordered) {
            const spec = Fleet.Machine.Spec.create(role, workspaceId, plan, release, baseEnvKeys, backendEnvKeys, backendHost)
            const handle = await this.machineService.create(driver, hardware.id, workspaceId, spec);

            if (role === 'backend')
                backendHost = await driver.getInternalHostForMachine(handle.resourceId);
        }
    }




    /** Replaces every machine; row, database, hostnames and secrets survive. The caller stops it first. */
    async rebuild(
        workspaceId: Workspace.Id,
        plan:        Plan,
        baseEnvKeys:    Fleet.Machine.EnvKeys.Base,
        backendEnvKeys: Fleet.Machine.EnvKeys.Backend,
    ): Promise<void> {
        await this.destroyCompute(workspaceId);

        await this.assemble(workspaceId, plan, baseEnvKeys, backendEnvKeys);
    }




    /** Reconciles the machines to a new plan's topology; the database survives. */
    async convertTo(
        workspaceId: Workspace.Id,
        plan:        Plan,
        baseEnvKeys:    Fleet.Machine.EnvKeys.Base,
        backendEnvKeys: Fleet.Machine.EnvKeys.Backend,
    ): Promise<void> {
        const hardware = await this.repository.getByWorkspace(Principal.SELF, workspaceId);

        if (!hardware)
            throw new Error(`No hardware to convert for ${workspaceId}`);

        const driver  = this.driverRegistry.getDriverForKind(hardware.driver);
        const current = await this.machineService.getAll(workspaceId);
        const desired = new Set(Plan.getMachineRoles(plan));
        const have    = new Set(current.map((machine) => machine.role));

        // Outgoing first, so the two topologies never exist at once.
        for (const machine of current)
            if (!desired.has(machine.role))
                await this.machineService.destroy(driver, machine);

        const backend = current.find((machine) => machine.role === 'backend');

        try {
            await this.buildCompute(
                workspaceId,
                plan,
                [...desired].filter((role) => !have.has(role)),
                baseEnvKeys,
                backendEnvKeys,
                backend ? await driver.getInternalHostForMachine(backend.resourceId) : null,
            );
        }
        catch (conversionError) {
            // The old topology's machines are already gone, so put them back before reporting.
            try {
                await this.rollbackTopology(workspaceId, plan, [...have], baseEnvKeys, backendEnvKeys);
            }
            catch (restoreError) {
                throw new TopologyNotRestored(workspaceId, conversionError, restoreError);
            }

            // Back as it was, but still an error: the caller asked for a topology it has not got.
            throw conversionError;
        }
    }




    /** Rebuilds a topology a failed conversion took apart. */
    private async rollbackTopology(
        workspaceId:    Workspace.Id,
        // The plan converted to; the old one is recorded nowhere. Sizes only — the roles say the shape.
        plan:           Plan,
        machineRoles:   Fleet.Machine.Role[],
        baseEnvKeys:    Fleet.Machine.EnvKeys.Base,
        backendEnvKeys: Fleet.Machine.EnvKeys.Backend,
    ): Promise<void> {
        const wanted = new Set(machineRoles);

        const hardware = await this.getHardware(workspaceId);

        const driver = this.driverRegistry.getDriverForKind(hardware.driver);

        // Whatever the failed attempt made goes first, so only the wanted roles are left.
        for (const machine of await this.machineService.getAll(workspaceId))
            if (!wanted.has(machine.role))
                await this.machineService.destroy(driver, machine);

        await this.buildCompute(workspaceId, plan, machineRoles, baseEnvKeys, backendEnvKeys, null);

        this.logger.log(`Restored the previous topology of ${workspaceId} after a failed conversion`);
    }




    /** Destroys the machines and their network; the hardware row stays. */
    async destroyCompute(workspaceId: Workspace.Id): Promise<void> {
        // From the row when there is one; nothing else records which driver it was.
        const hardware = await this.repository.getByWorkspace(Principal.SELF, workspaceId);

        const driver = hardware
            ? this.driverRegistry.getDriverForKind(hardware.driver)
            : this.driverRegistry.getDriverForNewWorkspaces();

        // Asked of the driver, so teardown catches machines no record knows about.
        const handles = await driver.findByWorkspace(workspaceId);

        // Removal is a kill that abandons connections; stopping is the caller's.
        const live = handles.filter((handle) => handle.state === 'running' || handle.state === 'suspended');

        if (live.length > 0)
            throw new Error(
                `Hardware for ${workspaceId} has ${live.length} live machine(s) `
                + `(${live.map((handle) => `${handle.resourceId} is ${handle.state}`).join(', ')}); `
                + 'stop it before destroying it',
            );

        for (const handle of handles)
            await driver.destroy(handle.resourceId);

        await driver.destroyScope(workspaceId);

        await this.machineRepository.deleteFor(Principal.SELF, workspaceId);

        this.logger.log(`Destroyed the machines of ${workspaceId}`);
    }




    /** Moves the workspace to a release; the machines change on the next rebuild. */
    async setRelease(workspaceId: Workspace.Id, releaseId: Fleet.Release.Id): Promise<void> {
        await this.repository.setRelease(Principal.SELF, workspaceId, releaseId);
    }




    /** Gives back everything `provision` allocated. Absence means it is already given back. */
    async destroy(workspaceId: Workspace.Id): Promise<void> {
        // Read before the row goes: the only record of which cluster holds the database.
        const hardware = await this.repository.getByWorkspace(Principal.SELF, workspaceId);

        // The row goes last, so no row means the rest already went; only machines
        // no record knows about are left to look for.
        if (!hardware) {
            await this.destroyCompute(workspaceId);

            return;
        }

        const cluster = await this.clusterService.getClusterById(hardware.cluster_id);

        await this.destroyCompute(workspaceId);

        await this.clusterService.dropDatabase(
            cluster,
            Provisioning.getDatabaseName(workspaceId),
            Provisioning.getRoleName(workspaceId),
        );

        await this.repository.deleteFor(Principal.SELF, workspaceId);

        this.logger.log(`Destroyed hardware for ${workspaceId}`);
    }
}
