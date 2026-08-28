import { Injectable, Logger } from '@nestjs/common';
import { Fleet, Plan, Workspace } from '@pretzel-cloud/shared/domain';
import { Provisioning } from '@pretzel-cloud/shared/domain/Workspace/provisioning';
import { FleetDB } from '@/db/fleet';
import { requireEnv } from '@/db/table';
import { AbstractHardwareDriver } from '../drivers/driver';
import { HardwareDriverRegistry } from '../drivers/driver.registry';
import { MachineService } from '../Machine/machine.service';
import { MachineDatabase } from '../Machine/machine.database';
import { HardwareDatabase } from './hardware.database';
import { ClusterService } from '../cluster/cluster.service';

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

/** A workspace's compute as one thing; state, health and lifecycle collapse over its machines. */
@Injectable()
export class HardwareService {

    private readonly logger = new Logger(HardwareService.name);

    constructor(
        private readonly hardwareDriverRegistry: HardwareDriverRegistry,
        private readonly machineService:         MachineService,
        private readonly machineDatabase:        MachineDatabase,
        private readonly hardwareDatabase:       HardwareDatabase,
        private readonly clusterService:         ClusterService,
    ) {}

    /**
     * The platform, the cluster, and the workspace's own database on it. Idempotent — the row
     * is written before the database it names. The returned URL carries the password, minted here.
     */
    async provision(workspaceId: Workspace.Id): Promise<Fleet.Cluster.Database.ConnectionURL> {
        const cluster = await this.clusterService.getClusterForNewWorkspace();

        const driverKind = this.hardwareDriverRegistry.getKindForNewWorkspaces()

        await FleetDB.asService('allocate hardware', (trx) =>
            this.hardwareDatabase.ensureForWorkspace(trx, workspaceId, driverKind, cluster.id));

        return this.clusterService.createDatabase(
            cluster,
            Provisioning.getDatabaseName(workspaceId),
            Provisioning.getRoleName(workspaceId),
        );
    }




    /** The row, or a throw — everything below needs hardware allocated first. */
    async getHardware(workspaceId: Workspace.Id): Promise<FleetDB.Hardware.Row> {
        const hardware = await FleetDB.asService('read hardware', (trx) =>
            this.hardwareDatabase.getByWorkspace(trx, workspaceId));

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
        await this.buildCompute(workspaceId, plan, Plan.getMachineRoles(plan), baseEnvKeys, backendEnvKeys, null);
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

        const driver = this.hardwareDriverRegistry.getDriverForKind(hardware.driver);

        const ordered = Fleet.Machine.inLifecycleOrder('start', machineRoles.map((role) => ({ role })));

        for (const { role } of ordered) {
            const spec = this.getSpecForMachine(role, workspaceId, plan, baseEnvKeys, backendEnvKeys, backendHost)
            const handle = await this.machineService.create(driver, hardware.id, workspaceId, spec);

            if (role === 'backend')
                backendHost = await driver.getInternalHostForMachine(handle.resourceId);
        }
    }





    /** One role's spec: the backend gets the credentials, the worker only where its sibling is. */
    private getSpecForMachine(
        role:        Fleet.Machine.Role,
        workspaceId: Workspace.Id,
        plan:        Plan,
        baseEnvKeys:    Fleet.Machine.EnvKeys.Base,
        backendEnvKeys: Fleet.Machine.EnvKeys.Backend,
        backendHost: string | null,
    ): Fleet.Machine.Spec {
        if (role === 'combined')
            return {
                role,
                image: requireEnv('WORKSPACE_IMAGE'),
                size:  Plan.getSizeForRole(plan, role),
                env:   backendEnvKeys,
            };

        if (role === 'backend')
            return {
                role,
                image: requireEnv('WORKSPACE_IMAGE_BACKEND'),
                size:  Plan.getSizeForRole(plan, role),
                env:   backendEnvKeys,
            };

        if (!backendHost)
            throw new Error(`A worker for ${workspaceId} has no backend to reach`);

        // Built from the base env, so a backend-only key can never leak to a worker.
        return {
            role,
            image: requireEnv('WORKSPACE_IMAGE_WORKER'),
            size:  Plan.getSizeForRole(plan, role),
            env:   {
                ...baseEnvKeys,
                REDIS_HOST: backendHost,
                REDIS_PORT: '6379',
                API_URL:    `http://${backendHost}:3001`,
            },
        };
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
        const hardware = await FleetDB.asService('read hardware', (trx) => this.hardwareDatabase.getByWorkspace(trx, workspaceId));

        if (!hardware)
            throw new Error(`No hardware to convert for ${workspaceId}`);

        const driver  = this.hardwareDriverRegistry.getDriverForKind(hardware.driver);
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

        const driver = this.hardwareDriverRegistry.getDriverForKind(hardware.driver);

        // Whatever the failed attempt made goes first, so only the wanted roles are left.
        for (const machine of await this.machineService.getAll(workspaceId))
            if (!wanted.has(machine.role))
                await this.machineService.destroy(driver, machine);

        await this.buildCompute(workspaceId, plan, machineRoles, baseEnvKeys, backendEnvKeys, null);

        this.logger.log(`Restored the previous topology of ${workspaceId} after a failed conversion`);
    }





    /** Blocks until every recorded machine reports serving. */
    async awaitHealthy(workspaceId: Workspace.Id): Promise<void> {
        const machines = await this.machineService.getAll(workspaceId);

        if (machines.length === 0)
            throw new Error(`No machines to await for ${workspaceId}`);

        await Promise.all(machines.map((machine) =>
            this.machineService.awaitHealthy(this.hardwareDriverRegistry.getDriverForKind(machine.driver), machine.resourceId)));

        // Nothing else runs after a first provision, and the idle sweep skips a machine reading `creating`.
        await this.refreshStates(workspaceId);
    }





    /** Starts the machine that answers HTTP; the worker is demand-driven. */
    async startBackend(workspaceId: Workspace.Id): Promise<void> {
        const backend = await this.machineService.getByRole(workspaceId, ['backend', 'combined']);

        const driver = this.hardwareDriverRegistry.getDriverForKind(backend!.driver)

        // A suspended machine resumes, a stopped one starts.
        if (backend?.state === 'suspended')
            await this.machineService.resume(driver, backend.resourceId);
        else if (backend?.state === 'stopped')
            await this.machineService.start(driver, backend.resourceId);

        await this.refreshStates(workspaceId);
    }





    /** Starts the queue drainer before enqueueing — a sleeping worker is not watching Redis. */
    async startWorker(workspaceId: Workspace.Id): Promise<void> {
        const worker = await this.machineService.getByRole(workspaceId, ['worker']);

        if (!worker) {
            // A combined machine is its own worker; anything else means the fleet has lost one.
            const combined = await this.machineService.getByRole(workspaceId, ['combined']);

            if (combined)
                return;

            throw new Error(`${workspaceId} has no worker machine to start`);
        }

        // The record can lag the machine, so the driver is asked before deciding.
        const state = await this.machineService.refreshState(this.hardwareDriverRegistry.getDriverForKind(worker.driver), worker);

        if (state === 'suspended')
            await this.machineService.resume(this.hardwareDriverRegistry.getDriverForKind(worker.driver), worker.resourceId);
        else if (state === 'stopped')
            await this.machineService.start(this.hardwareDriverRegistry.getDriverForKind(worker.driver), worker.resourceId);

        await this.refreshStates(workspaceId);
    }





    /** Nothing left running — worker included. */
    stopAll(workspaceId: Workspace.Id): Promise<void> {
        return this.fanOut(workspaceId, 'stop');
    }





    /** Whether the workspace answers right now. The cheap check before waking: writes nothing. */
    async isServing(workspaceId: Workspace.Id): Promise<boolean> {
        const backend = await this.machineService.getByRole(workspaceId, ['backend', 'combined']);

        if (!backend)
            return false;

        const driver = this.hardwareDriverRegistry.getDriverForKind(backend.driver);

        if (await this.machineService.getState(driver, backend.resourceId) !== 'running')
            return false;

        // `unknown` covers an image that declares no health check at all.
        return await this.machineService.health(driver, backend.resourceId) !== 'unhealthy';
    }





    /** Whether there is anything to start; the hardware row outlives the machines. */
    async hasMachines(workspaceId: Workspace.Id): Promise<boolean> {
        return (await this.machineService.getAll(workspaceId)).length > 0;
    }





    /** Marks the workspace as used just now. */
    async touch(workspaceId: Workspace.Id): Promise<void> {
        await FleetDB.asService('record workspace activity', (trx) => this.hardwareDatabase.touch(trx, workspaceId));
    }





    /** When each workspace was last used, for the idle sweep. */
    getLastSeen(): Promise<{ workspaceId: Workspace.Id; lastSeenAt: Date }[]> {
        return FleetDB.asService('read workspace activity', (trx) => this.hardwareDatabase.getLastSeen(trx));
    }





    /** A running worker means work is in flight. */
    async hasRunningWorker(workspaceId: Workspace.Id): Promise<boolean> {
        const worker = await this.machineService.getByRole(workspaceId, ['worker']);

        if (!worker)
            return false;

        return await this.machineService.refreshState(this.hardwareDriverRegistry.getDriverForKind(worker.driver), worker) === 'running';
    }





    /** Stops the queue drainer, leaving the backend answering. A combined machine is left alone. */
    async stopWorker(workspaceId: Workspace.Id): Promise<void> {
        const worker = await this.machineService.getByRole(workspaceId, ['worker']);

        if (!worker)
            return;

        // The record can lag the machine, so the driver is asked before deciding.
        const state = await this.machineService.refreshState(this.hardwareDriverRegistry.getDriverForKind(worker.driver), worker);

        if (Fleet.Machine.canApply('stop', { role: worker.role, state }))
            await this.machineService.stop(this.hardwareDriverRegistry.getDriverForKind(worker.driver), worker.resourceId);

        await this.refreshStates(workspaceId);
    }





    /** Freezes what can be frozen; a worker exceeds the snapshot ceiling. */
    suspendBackend(workspaceId: Workspace.Id): Promise<void> {
        return this.fanOut(workspaceId, 'suspend');
    }





    /** Everything down, then answerable again. The worker returns on demand. */
    async restartAll(workspaceId: Workspace.Id): Promise<void> {
        await this.stopAll(workspaceId);
        await this.startBackend(workspaceId);
    }





    /** One action across every machine it applies to; inapplicable ones are skipped, not failed. */
    private async fanOut(workspaceId: Workspace.Id, action: Fleet.Machine.LifecycleAction): Promise<void> {
        // Stopping the backend first would strand the worker, whose shutdown needs the queue.
        const machines = Fleet.Machine.inLifecycleOrder(action, await this.machineService.getAll(workspaceId));

        for (const machine of machines)
            if (Fleet.Machine.canApply(action, machine))
                await this.dispatch(this.hardwareDriverRegistry.getDriverForKind(machine.driver), machine.resourceId, action);

        await this.refreshStates(workspaceId);
    }





    private dispatch(driver: AbstractHardwareDriver, resourceId: Fleet.Machine.ResourceId, action: Fleet.Machine.LifecycleAction): Promise<void> {
        switch (action) {
            case 'start':   return this.machineService.start(driver, resourceId);
            case 'stop':    return this.machineService.stop(driver, resourceId);
            case 'suspend': return this.machineService.suspend(driver, resourceId);
            case 'resume':  return this.machineService.resume(driver, resourceId);
            case 'restart': return this.machineService.restart(driver, resourceId);
        }
    }





    private async refreshStates(workspaceId: Workspace.Id): Promise<void> {
        for (const machine of await this.machineService.getAll(workspaceId))
            await this.machineService.refreshState(this.hardwareDriverRegistry.getDriverForKind(machine.driver), machine);
    }





    /** The state each of many workspaces presents, for the grid. */
    async getStates(workspaceIds: Workspace.Id[]): Promise<Map<Workspace.Id, Fleet.Machine.State>> {
        if (workspaceIds.length === 0)
            return new Map();

        const rows = await FleetDB.asService('read machine states', (trx) =>
            this.machineDatabase.getStatesByWorkspaces(trx, workspaceIds));

        const map = new Map<Workspace.Id, Fleet.Machine.State>();

        // The backend's state is the hardware's; a worker between jobs is not a workspace down.
        for (const row of rows)
            if (row.role === 'backend' || row.role === 'combined')
                map.set(row.workspace_id, Fleet.Machine.State.parse(row.state));

        return map;
    }





    /** Where the router forwards a workspace's traffic, or null when asleep. */
    async getBackendAddress(workspaceId: Workspace.Id): Promise<URL | null> {
        const backend = await this.machineService.getByRole(workspaceId, ['backend', 'combined']);

        return backend ? this.machineService.address(this.hardwareDriverRegistry.getDriverForKind(backend.driver), backend.resourceId) : null;
    }





    /** Destroys the machines and their network; the hardware row stays. */
    async destroyCompute(workspaceId: Workspace.Id): Promise<void> {
        // From the row when there is one; nothing else records which driver it was.
        const hardware = await FleetDB.asService('read hardware', (trx) => this.hardwareDatabase.getByWorkspace(trx, workspaceId));

        const driver = hardware
            ? this.hardwareDriverRegistry.getDriverForKind(hardware.driver)
            : this.hardwareDriverRegistry.getDriverForNewWorkspaces();

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

        await FleetDB.asService('clear machine rows', (trx) => this.machineDatabase.deleteFor(trx, workspaceId));

        this.logger.log(`Destroyed the machines of ${workspaceId}`);
    }





    /** Gives back everything `provision` allocated. */
    async destroy(workspaceId: Workspace.Id): Promise<void> {
        // Read before the row goes: the only record of which cluster holds the database.
        const hardware = await this.getHardware(workspaceId);

        const cluster = await this.clusterService.getClusterById(hardware.cluster_id);

        await this.destroyCompute(workspaceId);

        await this.clusterService.dropDatabase(
            cluster,
            Provisioning.getDatabaseName(workspaceId),
            Provisioning.getRoleName(workspaceId),
        );

        await FleetDB.asService('clear hardware row', (trx) => this.hardwareDatabase.deleteFor(trx, workspaceId));

        this.logger.log(`Destroyed hardware for ${workspaceId}`);
    }
}
