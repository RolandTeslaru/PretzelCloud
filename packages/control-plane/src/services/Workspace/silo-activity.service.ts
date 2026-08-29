import { forwardRef, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Plan, Workspace } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';
import { HardwareService } from '@/services/Fleet/Hardware/hardware.service';
import { PlanRegistry } from '@/services/Plan/plan.registry';
import { LockService } from '@/services/Locking/lock.service';
import { WorkspaceService } from './workspace.service';

/** Quiet for this long and a workspace whose plan allows it is put to sleep. */
const IDLE_MS = 20 * 60_000;

/**
 * Quiet for this long and its machines are given back entirely. Only compute
 * goes: the database is in the cluster and the hostnames are the fleet's, so
 * the workspace is rebuilt from its spec on the next request.
 */
const RECLAIM_MS = 7 * 24 * 60 * 60_000;

/** How often the fleet is checked over. */
const SWEEP_MS = 60_000;

// Namespaces the advisory lock. One sweeper at a time however many instances run:
// every transition below is locked per workspace anyway, so a second sweeper
// would only re-read the fleet and then be refused, once per workspace, in the log.
const SWEEP_LOCK = 'fleet-sweep';

/**
 * At most one write per workspace per window, however busy it is: the record
 * only has to be accurate to within the shortest rung of the ladder.
 */
const TOUCH_THROTTLE_MS = 60_000;

/**
 * When each workspace was last used, and what follows from it having not been.
 *
 * Recorded rather than counted in memory: the thresholds run to days, and a
 * process that restarts would otherwise forget how long everything had been
 * quiet and give it all a fresh window.
 */
@Injectable()
export class SiloActivityService implements OnModuleInit, OnModuleDestroy {

    private readonly logger = new Logger(SiloActivityService.name);

    /** Last write per workspace, so a busy one is not written on every request. */
    private readonly writtenAt = new Map<Workspace.Id, number>();

    private sweepTimer: NodeJS.Timeout | null = null;

    constructor(
        // Circular by nature: resolving a request records activity, and acting
        // on it drives the same lifecycle the router reads back.
        @Inject(forwardRef(() => WorkspaceService))
        private readonly workspaceService: WorkspaceService,
        private readonly hardwareService:   HardwareService,
        private readonly planRegistry:      PlanRegistry,
        private readonly lockService:       LockService,
    ) {}

    onModuleInit(): void {
        this.sweepTimer = setInterval(() => void this.sweep(), SWEEP_MS);

        // Don't keep the event loop alive just for the sweep.
        this.sweepTimer.unref();
    }

    onModuleDestroy(): void {
        if (this.sweepTimer)
            clearInterval(this.sweepTimer);

        this.sweepTimer = null;

        this.writtenAt.clear();
    }

    /** Called by the router for every request that reaches a workspace. */
    noteActivity(workspaceId: Workspace.Id): void {
        const last = this.writtenAt.get(workspaceId) ?? 0;

        if (Date.now() - last < TOUCH_THROTTLE_MS)
            return;

        this.writtenAt.set(workspaceId, Date.now());

        void this.hardwareService.touch(workspaceId)
            .catch((error) => this.logger.warn(`Could not record activity for ${workspaceId}: ${error instanceof Error ? error.message : error}`));
    }

    /** What has gone quiet long enough to act on, and what to do about it. */
    private async sweep(): Promise<void> {
        // Silent when refused: another instance sweeping is the expected case.
        await this.lockService.withDurableLock(SWEEP_LOCK, 'all', () => this.sweepHeld());
    }




    private async sweepHeld(): Promise<void> {
        try {
            const seen = await this.hardwareService.getLastSeen();

            const idle = seen.filter(({ lastSeenAt }) => Date.now() - lastSeenAt.getTime() >= IDLE_MS);

            if (idle.length === 0)
                return;

            const workspaceIds = idle.map(({ workspaceId }) => workspaceId);

            const planIdByWorkspaceId         = await this.getPlanIdsForWorkspaces(workspaceIds);
            const machineStateByWorkspaceId   = await this.hardwareService.getStates(workspaceIds);
            const lifecycleStateByWorkspaceId = await this.getLifecycleStatesForWorkspaces(workspaceIds);

            const quietForByWorkspaceId = new Map(idle.map(({ workspaceId, lastSeenAt }) => [workspaceId, Date.now() - lastSeenAt.getTime()]));

            for (const workspaceId of workspaceIds) {
                const planId = planIdByWorkspaceId.get(workspaceId);

                const plan = planId ? this.planRegistry.find(planId) : undefined;

                if (!plan || plan.idleBackendPolicy === 'none')
                    continue;

                const state = lifecycleStateByWorkspaceId.get(workspaceId)

                // Stopped or disabled is where its owner or its billing put it.
                if (!Workspace.Lifecycle.acceptsTraffic(state ?? 'creating'))
                    continue;

                // Longest rung first: a workspace due to be reclaimed is past
                // caring whether it is running.
                if ((quietForByWorkspaceId.get(workspaceId) ?? 0) >= RECLAIM_MS) {
                    await this.reclaim(workspaceId);

                    continue;
                }

                if (machineStateByWorkspaceId.get(workspaceId) !== 'running')
                    continue;

                await this.suspend(workspaceId);
            }
        }
        catch (error) {
            this.logger.error(`Activity sweep failed: ${error instanceof Error ? error.message : error}`);
        }
    }

    private async suspend(workspaceId: Workspace.Id): Promise<void> {
        try {
            // Work is in flight; the backend holds the queue it runs from.
            if (await this.hardwareService.hasRunningWorker(workspaceId))
                return;

            await this.workspaceService.suspend(workspaceId);

            this.logger.log(`Slept ${workspaceId} after an idle period`);
        }
        catch (error) {
            this.logger.warn(`Could not suspend ${workspaceId}: ${error instanceof Error ? error.message : error}`);
        }
    }

    /** Gives the machines back once a workspace has gone a week unused. */
    private async reclaim(workspaceId: Workspace.Id): Promise<void> {
        try {
            // The hardware row outlives the machines, so a reclaimed workspace stays in the sweep with nothing left to take.
            if (!await this.hardwareService.hasMachines(workspaceId))
                return;

            if (await this.hardwareService.hasRunningWorker(workspaceId))
                return;

            await this.workspaceService.reclaimCompute(workspaceId);

            this.logger.log(`Reclaimed the machines of ${workspaceId} after a week unused`);
        }
        catch (error) {
            this.logger.warn(`Could not reclaim ${workspaceId}: ${error instanceof Error ? error.message : error}`);
        }
    }

    /** Which plan each workspace is on. The row behind the id is held in memory. */
    private async getPlanIdsForWorkspaces(workspaceIds: Workspace.Id[]): Promise<Map<Workspace.Id, Plan.Id>> {
        const rows = await PortalDB.asService('read plans for activity sweep', (db) =>
            db.selectFrom('workspaces').select(['id', 'plan_id']).where('id', 'in', workspaceIds).execute());

        return new Map(rows.map((row) => [row.id as Workspace.Id, row.plan_id as Plan.Id]));
    }

    private async getLifecycleStatesForWorkspaces(workspaceIds: Workspace.Id[]): Promise<Map<Workspace.Id, Workspace.Lifecycle.State>> {
        const rows = await PortalDB.asService('read lifecycles for activity sweep', (db) =>
            db.selectFrom('workspaces').select(['id', 'lifecycle_state']).where('id', 'in', workspaceIds).execute());

        return new Map(rows.map((row) => [row.id as Workspace.Id, row.lifecycle_state as Workspace.Lifecycle.State]));
    }
}
