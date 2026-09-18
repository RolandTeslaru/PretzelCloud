import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Fleet, Plan, Workspace } from '@pretzel-cloud/shared/domain';
import { Provisioning } from '@pretzel-cloud/shared/domain/Workspace/provisioning';
import { Principal } from '@/auth/identity/principal';
import { DriverRegistry } from '../drivers/driver.registry';
import { MachineService } from '../Machine/machine.service';
import { MachineRepository } from '../Machine/machine.repository';
import { HardwareRepository } from './hardware.repository';
import { ClusterService } from '../cluster/cluster.service';
import { ReleaseService } from '../Release/release.service';
import { HardwareLifecycleService } from './lifecycle.service';
import { HardwareStateService } from './state.service';
import { HardwareStatisticsSampler } from './statistics.sampler';
import { HardwareStatisticsService } from './statistics.service';

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
        private readonly statisticsService: HardwareStatisticsService,

        public readonly lifecycle:  HardwareLifecycleService,
        public readonly state:      HardwareStateService,
        public readonly statistics: HardwareStatisticsSampler,
    ) {}




    /**
     * The platform, the cluster, and the workspace's own database on it. Idempotent — the row
     * is written before the database it names. The returned URL carries the password, minted here.
     */
    async provision(workspaceId: Workspace.Id, region: Fleet.Region.Schema): Promise<Fleet.Cluster.Database.ConnectionURL> {
        const cluster = await this.clusterService.getClusterForNewWorkspace(region);

        const driverKind = this.driverRegistry.getKindForNewWorkspaces()

        const release = await this.releaseService.getLatest();

        if (!release)
            throw new Error('No release to build workspaces from');

        await this.repository.ensureForWorkspace(Principal.SELF, workspaceId, driverKind, cluster, release.id);

        return this.clusterService.createDatabase(
            cluster,
            Provisioning.getDatabaseName(workspaceId),
            Provisioning.getRoleName(workspaceId),
        );
    }




    /** The row, or a throw — everything below needs hardware allocated first. */
    async getHardware(workspaceId: Workspace.Id): Promise<Fleet.Hardware> {
        const hardware = await this.repository.getByWorkspace(Principal.SELF, workspaceId);

        if (!hardware)
            throw new Error(`${workspaceId} has no hardware`);

        return hardware;
    }




    /**
     * Creates the plan's machines in bring-up order, so a worker is built from a backend address
     * that exists. Workers take the ids the backend's env already names.
     */
    async buildCompute(
        workspaceId:    Workspace.Id,
        plan:           Plan,
        baseEnvKeys:    Fleet.Machine.EnvKeys.Base,
        backendEnvKeys: Fleet.Machine.EnvKeys.Backend,
        workerIds:      Fleet.Machine.Id[],
    ): Promise<void> {
        const hardware = await this.getHardware(workspaceId);

        const driver = this.driverRegistry.getDriverForKind(hardware.driver);

        const release = await this.releaseService.getById(hardware.releaseId);

        const frontlineRole: Fleet.Machine.Role = Plan.isCombined(plan) ? 'combined' : 'backend';

        const frontlineSpec = Fleet.Machine.Spec.create(
            Fleet.Machine.Id.parse(randomUUID()),
            frontlineRole,
            workspaceId,
            plan,
            release,
            baseEnvKeys,
            backendEnvKeys,
            null,
        );

        const frontline = await this.machineService.create(hardware.driver, hardware.id, workspaceId, hardware.region, frontlineSpec);

        let workers: Fleet.Machine[] = [];

        if (frontline.role === 'backend') {
            const backendHost = await driver.getInternalHostForMachine(frontline.resourceId);

            workers = await Promise.all(workerIds.map((id) => {
                const spec = Fleet.Machine.Spec.create(id, 'worker', workspaceId, plan, release, baseEnvKeys, backendEnvKeys, backendHost);

                return this.machineService.create(hardware.driver, hardware.id, workspaceId, hardware.region, spec);
            }));
        }

        hardware.machines = [frontline, ...workers];

        // New machines carry new ids, so a reading from before this keys machines that are gone.
        this.statisticsService.invalidate(workspaceId);

        // Created is not serving: every machine must complete its first boot.
        await this.lifecycle.awaitHealthy(hardware);
    }




    /** Replaces every machine; row, database, hostnames and secrets survive. The caller stops it first. */
    async rebuild(
        workspaceId: Workspace.Id,
        plan:        Plan,
        baseEnvKeys:    Fleet.Machine.EnvKeys.Base,
        backendEnvKeys: Fleet.Machine.EnvKeys.Backend,
        workerIds:      Fleet.Machine.Id[],
    ): Promise<void> {
        await this.destroyCompute(workspaceId);

        await this.buildCompute(workspaceId, plan, baseEnvKeys, backendEnvKeys, workerIds);
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

        this.statisticsService.invalidate(workspaceId);

        this.logger.log(`Destroyed the machines of ${workspaceId}`);
    }




    /** Where each workspace lives and what it runs, keyed by workspace. */
    async getHardwareFieldsForWorkspaces(workspaceIds: Workspace.Id[]): Promise<Map<Workspace.Id, { region: Fleet.Region.Schema; driver: Fleet.Hardware.Driver; releaseId: Fleet.Release.Id; releaseName: Fleet.Release.Name }>> {
        const rows = await this.repository.getHardwareFieldsForWorkspaces(Principal.SELF, workspaceIds);

        return new Map(rows.map((row) => [row.workspaceId, { region: row.region, driver: row.driver, releaseId: row.releaseId, releaseName: row.releaseName }]));
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

        const cluster = await this.clusterService.getClusterById(hardware.clusterId);

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
