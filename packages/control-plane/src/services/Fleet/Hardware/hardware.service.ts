import { Injectable, Logger } from '@nestjs/common';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { FleetDB } from '@/db/fleet';
import { requireEnv } from '@/db/table';
import { AbstractHardwareDriver } from '../drivers/driver';
import { DockerDriver } from '../drivers/docker.driver';
import { MachineService } from '../Machine/machine.service';
import { MachineDatabase } from '../Machine/machine.database';
import { HardwareDatabase } from './hardware.database';

/**
 * A workspace's compute, as one thing. The fleet talks to hardware; hardware
 * fans out to its machines. State, health and lifecycle are all collapses over
 * the machines beneath it.
 */
@Injectable()
export class HardwareService {

    private readonly logger = new Logger(HardwareService.name);

    constructor(
        private readonly driver:    AbstractHardwareDriver,
        private readonly machines:  MachineService,
        private readonly machineDb: MachineDatabase,
        private readonly db:        HardwareDatabase,
    ) {}

    /**
     * Materializes a workspace's compute: the hardware row and the machines its
     * plan calls for. The caller never names roles — the topology is the
     * hardware's own decision, derived from the plan. Idempotent.
     */
    async build(
        workspaceId: Workspace.Id,
        plan:        Workspace.Plan,
        inputs:      Fleet.Machine.Spec.Inputs,
    ): Promise<void> {
        const hardware = await FleetDB.asService('build hardware', (trx) => this.db.insert(trx, workspaceId, this.driver.kind));

        for (const role of Workspace.getTopology(plan))
            await this.machines.create(hardware.id, workspaceId, this.specFor(role, workspaceId, inputs));
    }

    /**
     * Builds one role's spec. The roles share their env and differ in what they
     * are told: the backend is given the credential and the wake endpoint, the
     * worker only where its sibling is, since Redis and the API both live there.
     */
    private specFor(
        role:        Fleet.Machine.Role,
        workspaceId: Workspace.Id,
        inputs:      Fleet.Machine.Spec.Inputs,
    ): Fleet.Machine.Spec {
        const env = Fleet.Machine.Spec.baseEnv(inputs);

        if (role === 'combined')
            return {
                role,
                env,
                image: requireEnv('WORKSPACE_IMAGE'),
                size:  process.env.WORKSPACE_SIZE ?? 'shared-1x-512',
            };

        if (role === 'backend')
            return {
                role,
                env,
                image:         requireEnv('WORKSPACE_IMAGE_BACKEND'),
                size:          requireEnv('WORKSPACE_SIZE_BACKEND'),
                backendToken:       inputs.backendToken,
                workerLifecycleUrl: `${requireEnv('CONTROL_PLANE_INTERNAL_URL')}/api/workspaces/${workspaceId}/worker`,
            };

        return {
            role,
            env,
            image:       requireEnv('WORKSPACE_IMAGE_WORKER'),
            size:        requireEnv('WORKSPACE_SIZE_WORKER'),
            backendHost: Fleet.Machine.Name.create(workspaceId, 'backend'),
        };
    }

    /**
     * Replaces every machine with one built from the spec as it stands now.
     * Only compute is discarded: the database lives in the cluster, and the
     * hostnames and secrets are the fleet's, so nothing the workspace holds
     * goes with it. The caller stops the hardware first — destroy refuses a
     * live machine.
     */
    async rebuild(
        workspaceId: Workspace.Id,
        plan:        Workspace.Plan,
        inputs:      Fleet.Machine.Spec.Inputs,
    ): Promise<void> {
        await this.destroy(workspaceId);

        await this.build(workspaceId, plan, inputs);
    }

    /**
     * Reconciles the machines to a new plan's topology: adds the roles it now
     * calls for, removes the ones it no longer does. The workspace's database
     * lives in the cluster, not on a machine, so its data survives the change.
     *
     * A no-op today — free and paid both resolve to one combined machine — but
     * the seam the split and plan upgrades reconcile through.
     */
    async convertTo(
        workspaceId: Workspace.Id,
        plan:        Workspace.Plan,
        inputs:      Fleet.Machine.Spec.Inputs,
    ): Promise<void> {
        const hardware = await FleetDB.asService('read hardware', (trx) => this.db.getByWorkspace(trx, workspaceId));

        if (!hardware)
            throw new Error(`No hardware to convert for ${workspaceId}`);

        const current = await this.machines.getAll(workspaceId);
        const desired = new Set(Workspace.getTopology(plan));
        const have    = new Set(current.map((machine) => machine.role));

        // Outgoing first. The caller has already stopped the hardware, so
        // nothing is serving — and removing before creating means the two
        // topologies never exist at once.
        for (const machine of current)
            if (!desired.has(machine.role))
                await this.machines.destroy(machine);

        for (const role of desired)
            if (!have.has(role))
                await this.machines.create(hardware.id, workspaceId, this.specFor(role, workspaceId, inputs));
    }


    /**
     * Blocks until every machine of the workspace reports serving. The list
     * comes from the record, not the daemon: the DB is what says which machines
     * *should* exist; the driver only says whether each is healthy.
     */
    async awaitHealthy(workspaceId: Workspace.Id): Promise<void> {
        const machines = await this.machines.getAll(workspaceId);

        if (machines.length === 0)
            throw new Error(`No machines to await for ${workspaceId}`);

        await Promise.all(machines.map((machine) => this.machines.awaitHealthy(machine.externalId)));
    }


    /**
     * The machine that answers HTTP, started. The worker is left alone: it is
     * demand-driven, woken by the backend before it enqueues.
     */
    async startBackend(workspaceId: Workspace.Id): Promise<void> {
        const backend = await this.machines.getByRole(workspaceId, ['backend', 'combined']);

        // How a machine wakes depends on how it went down: a suspended one is
        // frozen and resumes, a stopped one is powered off and starts. Asking
        // for the wrong one leaves it exactly where it was.
        if (backend?.state === 'suspended')
            await this.machines.resume(backend.externalId);
        else if (backend?.state === 'stopped')
            await this.machines.start(backend.externalId);

        await this.refreshStates(workspaceId);
    }

    /**
     * The machine that drains the queue, started. Called before work is enqueued:
     * a sleeping worker is not watching Redis, so the job would sit until
     * something else woke it.
     */
    async startWorker(workspaceId: Workspace.Id): Promise<void> {
        const worker = await this.machines.getByRole(workspaceId, ['worker']);

        if (!worker) {
            // A combined machine has no worker to wake — its worker is the
            // machine the caller is already running on. Anything else means the
            // topology says there should be one and the fleet has lost it.
            const combined = await this.machines.getByRole(workspaceId, ['combined']);

            if (combined)
                return;

            throw new Error(`${workspaceId} has no worker machine to start`);
        }

        // The record can lag the machine, so the driver is asked before deciding.
        const state = await this.machines.refreshState(worker);

        if (state === 'suspended')
            await this.machines.resume(worker.externalId);
        else if (state === 'stopped')
            await this.machines.start(worker.externalId);

        await this.refreshStates(workspaceId);
    }

    /** Nothing left running — worker included. */
    stopAll(workspaceId: Workspace.Id): Promise<void> {
        return this.fanOut(workspaceId, 'stop');
    }

    /**
     * Stops the machine that drains the queue, leaving the backend answering.
     * A combined machine is left alone: its worker is the machine serving the
     * workspace, so stopping it would take the workspace down with it.
     */
    async stopWorker(workspaceId: Workspace.Id): Promise<void> {
        const worker = await this.machines.getByRole(workspaceId, ['worker']);

        if (!worker)
            return;

        // The record can lag the machine, so the driver is asked before deciding.
        const state = await this.machines.refreshState(worker);

        if (Fleet.Machine.canApply('stop', { role: worker.role, state }))
            await this.machines.stop(worker.externalId);

        await this.refreshStates(workspaceId);
    }

    /**
     * Frozen in place rather than powered off, for the machines that can be.
     * A worker exceeds the snapshot ceiling, so it is skipped and keeps running
     * until something stops it.
     */
    suspendBackend(workspaceId: Workspace.Id): Promise<void> {
        return this.fanOut(workspaceId, 'suspend');
    }

    /** Everything down, then answerable again. The worker returns on demand. */
    async restartAll(workspaceId: Workspace.Id): Promise<void> {
        await this.stopAll(workspaceId);
        await this.startBackend(workspaceId);
    }

    /**
     * One action across every machine it applies to, then the resulting states.
     * A machine the action does not apply to is skipped, not failed: suspending
     * hardware suspends what can suspend, and a worker simply is not one.
     */
    private async fanOut(workspaceId: Workspace.Id, action: Fleet.Machine.LifecycleAction): Promise<void> {
        // Ordered, not arbitrary: stopping the backend first would strand the
        // worker, whose shutdown needs the queue it is being cut off from.
        const machines = Fleet.Machine.inLifecycleOrder(action, await this.machines.getAll(workspaceId));

        for (const machine of machines)
            if (Fleet.Machine.canApply(action, machine))
                await this.dispatch(machine.externalId, action);

        await this.refreshStates(workspaceId);
    }

    private dispatch(externalId: Fleet.Machine.ExternalId, action: Fleet.Machine.LifecycleAction): Promise<void> {
        switch (action) {
            case 'start':   return this.machines.start(externalId);
            case 'stop':    return this.machines.stop(externalId);
            case 'suspend': return this.machines.suspend(externalId);
            case 'resume':  return this.machines.resume(externalId);
            case 'restart': return this.machines.restart(externalId);
        }
    }

    private async refreshStates(workspaceId: Workspace.Id): Promise<void> {
        for (const machine of await this.machines.getAll(workspaceId))
            await this.machines.refreshState(machine);
    }

    /** The state each of many workspaces presents, for the grid. */
    async getStates(workspaceIds: Workspace.Id[]): Promise<Map<Workspace.Id, Fleet.Machine.State>> {
        if (workspaceIds.length === 0)
            return new Map();

        const rows = await FleetDB.asService('read machine states', (trx) =>
            this.machineDb.getStatesByWorkspaces(trx, workspaceIds));

        const map = new Map<Workspace.Id, Fleet.Machine.State>();

        // The backend's state is the hardware's: it is what answers, so it is
        // what "is my workspace up" means. A worker between jobs is not a
        // workspace being down.
        for (const row of rows)
            if (row.role === 'backend' || row.role === 'combined')
                map.set(row.workspace_id, Fleet.Machine.State.parse(row.state));

        return map;
    }

    /**
     * The machine that answers HTTP: the backend of a split, or the combined
     * machine when there is no split. The one the router forwards to and wakes.
     */

    /** Where the router forwards a workspace's traffic, or null when asleep. */
    async getBackendAddress(workspaceId: Workspace.Id): Promise<URL | null> {
        const backend = await this.machines.getByRole(workspaceId, ['backend', 'combined']);

        return backend ? this.machines.address(backend.externalId) : null;
    }


    /** Destroys the machines, their network, and every fleet row for the workspace's compute. */
    async destroy(workspaceId: Workspace.Id): Promise<void> {
        // Asked of the driver rather than the rows: teardown must also catch
        // machines no record knows about.
        const handles = await this.driver.findByWorkspace(workspaceId);

        // Removal is a kill, and a killed machine abandons its customer
        // database connections instead of closing them. Stopping is the
        // caller's to do, so that it is never done by accident here.
        const live = handles.filter((handle) => handle.state === 'running' || handle.state === 'suspended');

        if (live.length > 0)
            throw new Error(
                `Hardware for ${workspaceId} has ${live.length} live machine(s) `
                + `(${live.map((handle) => `${handle.externalId} is ${handle.state}`).join(', ')}); `
                + 'stop it before destroying it',
            );

        for (const handle of handles)
            await this.driver.destroy(handle.externalId);

        if (this.driver instanceof DockerDriver)
            await this.driver.destroyNetwork(workspaceId);

        await FleetDB.asService('clear compute rows', async (trx) => {
            await this.machineDb.deleteFor(trx, workspaceId);
            await this.db.deleteFor(trx, workspaceId);
            await trx.deleteFrom('workspace_runtime').where('workspace_id', '=', workspaceId).execute();
        });

        this.logger.log(`Destroyed hardware for ${workspaceId}`);
    }
}
