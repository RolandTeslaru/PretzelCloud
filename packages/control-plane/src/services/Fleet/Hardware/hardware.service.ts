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

const describe = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * A conversion failed and the topology it took apart could not be rebuilt, so
 * the workspace has no machines and cannot get them back by itself.
 */
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

/** A workspace's compute as one thing; state, health and lifecycle collapse over the machines beneath it. */
@Injectable()
export class HardwareService {

    private readonly logger = new Logger(HardwareService.name);

    constructor(
        private readonly hardwareDriverRegistry: HardwareDriverRegistry,
        private readonly machineService:         MachineService,
        private readonly machineDatabase:        MachineDatabase,
        private readonly hardwareDatabase:       HardwareDatabase,
    ) {}

    /** Creates the hardware row and the machines the plan calls for; the caller never names roles. Idempotent. */
    async build(
        workspaceId:    Workspace.Id,
        plan:           Plan,
        baseEnvKeys:    Fleet.Machine.EnvKeys.Base,
        backendEnvKeys: Fleet.Machine.EnvKeys.Backend,
    ): Promise<void> {
        const hardware = await FleetDB.asService('build hardware', (trx) => this.hardwareDatabase.insert(trx, workspaceId, this.hardwareDriverRegistry.getKindForNewWorkspaces()));

        const machineRoles = Plan.getMachineRoles(plan)

        const driver = this.hardwareDriverRegistry.getDriverForKind(hardware.driver)

        await this.createTopology(
            driver, hardware.id, workspaceId, plan, machineRoles, baseEnvKeys, backendEnvKeys, null,
        );
    }

    /** Creates roles in bring-up order, so a worker is built from a backend address that exists. */
    private async createTopology(
        driver:         AbstractHardwareDriver,
        hardwareId:     Fleet.Hardware.Id,
        workspaceId:    Workspace.Id,
        plan:           Plan,
        roles:          Fleet.Machine.Role[],
        baseEnvKeys:    Fleet.Machine.EnvKeys.Base,
        backendEnvKeys: Fleet.Machine.EnvKeys.Backend,
        backendHost:    string | null,
    ): Promise<void> {
        const ordered = Fleet.Machine.inLifecycleOrder('start', roles.map((role) => ({ role })));

        for (const { role } of ordered) {
            const spec = this.getSpecForMachine(role, workspaceId, plan, baseEnvKeys, backendEnvKeys, backendHost)
            const handle = await this.machineService.create(driver, hardwareId, workspaceId, spec);

            if (role === 'backend')
                backendHost = await driver.getInternalHostForMachine(handle.resourceId);
        }
    }

    /** One role's spec: the backend gets the credential and wake endpoint, the worker only where its sibling is. */
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

    /** Replaces every machine from the current spec; database, hostnames and secrets survive. The caller stops the hardware first. */
    async rebuild(
        workspaceId: Workspace.Id,
        plan:        Plan,
        baseEnvKeys:    Fleet.Machine.EnvKeys.Base,
        backendEnvKeys: Fleet.Machine.EnvKeys.Backend,
    ): Promise<void> {
        await this.destroy(workspaceId);

        await this.build(workspaceId, plan, baseEnvKeys, backendEnvKeys);
    }

    /** Reconciles the machines to a new plan's topology; the database survives. A no-op while every plan is one combined machine. */
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

        // Outgoing first, so the two topologies never exist at once; the caller has already stopped the hardware.
        for (const machine of current)
            if (!desired.has(machine.role))
                await this.machineService.destroy(driver, machine);

        const backend = current.find((machine) => machine.role === 'backend');

        try {
            await this.createTopology(
                driver,
                hardware.id,
                workspaceId,
                plan,
                [...desired].filter((role) => !have.has(role)),
                baseEnvKeys,
                backendEnvKeys,
                backend ? await driver.getInternalHostForMachine(backend.resourceId) : null,
            );
        }
        catch (conversionError) {
            // The machines the old topology needed are already gone, so a failure
            // here leaves the workspace with nothing to run on. Put them back
            // before reporting it: nothing on a machine is the workspace's, so
            // rebuilding one is only slow, never lossy.
            try {
                await this.rollbackTopology(driver, hardware.id, workspaceId, plan, [...have], baseEnvKeys, backendEnvKeys);
            }
            catch (restoreError) {
                throw new TopologyNotRestored(workspaceId, conversionError, restoreError);
            }

            // Back as it was, so only the plan change failed. Still an error: the
            // caller asked for a topology it has not got.
            throw conversionError;
        }
    }

    /**
     * Rebuilds a topology a failed conversion took apart. Whatever it made
     * before failing goes first, so the roles it is asked for are the only ones
     * left afterwards.
     */
    private async rollbackTopology(
        driver:         AbstractHardwareDriver,
        hardwareId:     Fleet.Hardware.Id,
        workspaceId:    Workspace.Id,
        // The plan being converted to, since the one being restored is no longer
        // recorded anywhere. It decides sizes only, and the roles say the shape.
        plan:           Plan,
        roles:          Fleet.Machine.Role[],
        baseEnvKeys:    Fleet.Machine.EnvKeys.Base,
        backendEnvKeys: Fleet.Machine.EnvKeys.Backend,
    ): Promise<void> {
        const wanted = new Set(roles);

        // Whatever the failed attempt managed to make goes first, so the roles
        // asked for are the only ones left.
        for (const machine of await this.machineService.getAll(workspaceId))
            if (!wanted.has(machine.role))
                await this.machineService.destroy(driver, machine);

        await this.createTopology(driver, hardwareId, workspaceId, plan, roles, baseEnvKeys, backendEnvKeys, null);

        this.logger.log(`Restored the previous topology of ${workspaceId} after a failed conversion`);
    }


    /** Blocks until every recorded machine reports serving; the DB says which should exist, the driver whether each is healthy. */
    async awaitHealthy(workspaceId: Workspace.Id): Promise<void> {
        const machines = await this.machineService.getAll(workspaceId);

        if (machines.length === 0)
            throw new Error(`No machines to await for ${workspaceId}`);

        await Promise.all(machines.map((machine) =>
            this.machineService.awaitHealthy(this.hardwareDriverRegistry.getDriverForKind(machine.driver), machine.resourceId)));

        // Recorded here because this is where it stops being what `create`
        // returned. Nothing else runs after a first provision, and a machine
        // still reading `creating` is one the idle sweep will not act on.
        await this.refreshStates(workspaceId);
    }


    /** Starts the machine that answers HTTP; the worker is demand-driven and left alone. */
    async startBackend(workspaceId: Workspace.Id): Promise<void> {
        const backend = await this.machineService.getByRole(workspaceId, ['backend', 'combined']);

        const driver = this.hardwareDriverRegistry.getDriverForKind(backend!.driver)

        // A suspended machine resumes, a stopped one starts; asking for the wrong one leaves it where it was.
        if (backend?.state === 'suspended')
            await this.machineService.resume(driver, backend.resourceId);
        else if (backend?.state === 'stopped')
            await this.machineService.start(driver, backend.resourceId);

        await this.refreshStates(workspaceId);
    }

    /** Starts the queue drainer, called before enqueueing: a sleeping worker is not watching Redis. */
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

    /** Whether the workspace answers right now — the cheap check before waking, so it writes and announces nothing. */
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

    /**
     * Whether there is anything to start. Asked of the machines rather than the
     * hardware row: a reclaim removes both, but a conversion that failed part
     * way leaves the row behind, and a workspace with no machines needs
     * rebuilding either way.
     */
    async hasMachines(workspaceId: Workspace.Id): Promise<boolean> {
        return (await this.machineService.getAll(workspaceId)).length > 0;
    }

    /** Marks the workspace as used just now. */
    async touch(workspaceId: Workspace.Id): Promise<void> {
        await FleetDB.asService('record workspace activity', (trx) => this.hardwareDatabase.touch(trx, workspaceId));
    }

    /** When each workspace was last used, for deciding what to do about idleness. */
    getLastSeen(): Promise<{ workspaceId: Workspace.Id; lastSeenAt: Date }[]> {
        return FleetDB.asService('read workspace activity', (trx) => this.hardwareDatabase.getLastSeen(trx));
    }

    /** Whether the job runner is still up; a running worker means work is in flight. */
    async hasRunningWorker(workspaceId: Workspace.Id): Promise<boolean> {
        const worker = await this.machineService.getByRole(workspaceId, ['worker']);

        if (!worker)
            return false;

        return await this.machineService.refreshState(this.hardwareDriverRegistry.getDriverForKind(worker.driver), worker) === 'running';
    }

    /** Stops the queue drainer, leaving the backend answering; a combined machine is the workspace, so it is left alone. */
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

    /** Freezes what can be frozen; a worker exceeds the snapshot ceiling and is skipped. */
    suspendBackend(workspaceId: Workspace.Id): Promise<void> {
        return this.fanOut(workspaceId, 'suspend');
    }

    /** Everything down, then answerable again. The worker returns on demand. */
    async restartAll(workspaceId: Workspace.Id): Promise<void> {
        await this.stopAll(workspaceId);
        await this.startBackend(workspaceId);
    }

    /** One action across every machine it applies to, then the resulting states; inapplicable machines are skipped, not failed. */
    private async fanOut(workspaceId: Workspace.Id, action: Fleet.Machine.LifecycleAction): Promise<void> {
        // Ordered: stopping the backend first would strand the worker, whose shutdown needs the queue.
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

        // The backend's state is the hardware's: a worker between jobs is not a workspace being down.
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


    /** Destroys the machines, their network, and every fleet row for the workspace's compute. */
    async destroy(workspaceId: Workspace.Id): Promise<void> {
        // Read from the row when there is one. A workspace whose hardware is
        // already gone is torn down on the driver new ones are built with —
        // there is nothing left to say which it was.
        const hardware = await FleetDB.asService('read hardware', (trx) => this.hardwareDatabase.getByWorkspace(trx, workspaceId));

        const driver = hardware
            ? this.hardwareDriverRegistry.getDriverForKind(hardware.driver)
            : this.hardwareDriverRegistry.getDriverForNewWorkspaces();

        // Asked of the driver, not the rows, so teardown also catches machines no record knows about.
        const handles = await driver.findByWorkspace(workspaceId);

        // Removal is a kill that abandons database connections; stopping is the caller's, never done here by accident.
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

        await FleetDB.asService('clear compute rows', async (trx) => {
            await this.machineDatabase.deleteFor(trx, workspaceId);
            await this.hardwareDatabase.deleteFor(trx, workspaceId);
            await trx.deleteFrom('workspace_runtime').where('workspace_id', '=', workspaceId).execute();
        });

        this.logger.log(`Destroyed hardware for ${workspaceId}`);
    }
}
