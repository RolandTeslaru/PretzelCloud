import { Injectable, Logger } from '@nestjs/common';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { FleetDB } from '@/db/fleet';
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
        spec:        { image: string; size: string; env: Record<string, string> },
    ): Promise<void> {
        const hardware = await FleetDB.asService('build hardware', (trx) => this.db.insert(trx, workspaceId, this.driver.kind));

        for (const role of this.topologyFor(plan))
            await this.machines.create(hardware.id, workspaceId, role, spec);
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
        spec:        { image: string; size: string; env: Record<string, string> },
    ): Promise<void> {
        const hardware = await FleetDB.asService('read hardware', (trx) => this.db.getByWorkspace(trx, workspaceId));

        if (!hardware)
            throw new Error(`No hardware to convert for ${workspaceId}`);

        const current = await this.machines.listFor(workspaceId);
        const desired = new Set(this.topologyFor(plan));
        const have    = new Set(current.map((machine) => machine.role));

        for (const role of desired)
            if (!have.has(role))
                await this.machines.create(hardware.id, workspaceId, role, spec);

        for (const machine of current)
            if (!desired.has(machine.role))
                await this.machines.destroy(machine);
    }

    /**
     * The machines a plan's compute is made of. One combined machine today; the
     * paid split — an always-on backend and a usage-clock worker — lands here,
     * at which point role-specific env deltas join too.
     */
    private topologyFor(_plan: Workspace.Plan): Fleet.Machine.Role[] {
        return ['combined'];
    }

    /**
     * Blocks until every machine of the workspace reports serving. The list
     * comes from the record, not the daemon: the DB is what says which machines
     * *should* exist; the driver only says whether each is healthy.
     */
    async awaitHealthy(workspaceId: Workspace.Id): Promise<void> {
        const machines = await this.machines.listFor(workspaceId);

        if (machines.length === 0)
            throw new Error(`No machines to await for ${workspaceId}`);

        await Promise.all(machines.map((machine) => this.machines.awaitHealthy(machine.externalId)));
    }

    /** Drives every machine through one action, then records the result. */
    async applyAction(workspaceId: Workspace.Id, action: Fleet.Machine.LifecycleAction): Promise<void> {
        const machines = await this.machines.listFor(workspaceId);

        for (const machine of machines)
            await this.dispatch(machine.externalId, action);

        for (const machine of machines)
            await this.machines.refreshState(machine);
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

    /**
     * The state each of many workspaces presents, for the grid. Returns the
     * machine state today (one machine per workspace); switching the surfaced
     * value to the collapsed `Hardware.State` is a coordinated follow-up, since
     * the workspace DTO and the realtime event share the type.
     */
    async getStates(workspaceIds: Workspace.Id[]): Promise<Map<Workspace.Id, Fleet.Machine.State>> {
        if (workspaceIds.length === 0)
            return new Map();

        const rows = await FleetDB.asService('read machine states', (trx) =>
            this.machineDb.getStatesByWorkspaces(trx, workspaceIds));

        const map = new Map<Workspace.Id, Fleet.Machine.State>();

        for (const row of rows)
            if (!map.has(row.workspace_id))
                map.set(row.workspace_id, Fleet.Machine.State.parse(row.state));

        return map;
    }

    /**
     * The machine that answers HTTP: the backend of a split, or the combined
     * machine when there is no split. The one the router forwards to and wakes.
     */
    private backendOf(machines: Fleet.Machine[]): Fleet.Machine | undefined {
        return machines.find((m) => m.role === 'backend') ?? machines.find((m) => m.role === 'combined');
    }

    /** Where the router forwards a workspace's traffic, or null when asleep. */
    async getBackendAddress(workspaceId: Workspace.Id): Promise<URL | null> {
        const backend = this.backendOf(await this.machines.listFor(workspaceId));

        return backend ? this.machines.address(backend.externalId) : null;
    }

    /** Wakes the backend so it can serve. The worker, if any, is woken elsewhere. */
    async ensureBackendCaffeinated(workspaceId: Workspace.Id): Promise<void> {
        const backend = this.backendOf(await this.machines.listFor(workspaceId));

        if (backend)
            await this.machines.start(backend.externalId);
    }

    /** Destroys the machines, their network, and every fleet row for the workspace's compute. */
    async destroy(workspaceId: Workspace.Id): Promise<void> {
        for (const handle of await this.driver.findByWorkspace(workspaceId))
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
