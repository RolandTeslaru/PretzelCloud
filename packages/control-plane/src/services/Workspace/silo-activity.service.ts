import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Workspace } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';
import { HardwareService } from '@/services/Fleet/Hardware/hardware.service';
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
        private readonly workspaces: WorkspaceService,
        private readonly hardware:   HardwareService,
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

        void this.hardware.touch(workspaceId)
            .catch((error) => this.logger.warn(`Could not record activity for ${workspaceId}: ${error instanceof Error ? error.message : error}`));
    }

    /** What has gone quiet long enough to act on, and what to do about it. */
    private async sweep(): Promise<void> {
        try {
            const seen = await this.hardware.getLastSeen();

            const idle = seen.filter(({ lastSeenAt }) => Date.now() - lastSeenAt.getTime() >= IDLE_MS);

            if (idle.length === 0)
                return;

            const ids    = idle.map(({ workspaceId }) => workspaceId);
            const plans  = await this.getPlans(ids);
            const states = await this.hardware.getStates(ids);

            const quietFor = new Map(idle.map(({ workspaceId, lastSeenAt }) => [workspaceId, Date.now() - lastSeenAt.getTime()]));

            for (const workspaceId of ids) {
                const plan = plans.get(workspaceId);

                if (!plan || Workspace.getIdlePolicy(plan) === 'none')
                    continue;

                // Longest rung first: a workspace due to be reclaimed is past
                // caring whether it is running.
                if ((quietFor.get(workspaceId) ?? 0) >= RECLAIM_MS) {
                    await this.reclaim(workspaceId);

                    continue;
                }

                if (states.get(workspaceId) !== 'running')
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
            if (await this.hardware.hasRunningWorker(workspaceId))
                return;

            await this.workspaces.suspend(workspaceId);

            this.logger.log(`Suspended ${workspaceId} after an idle period`);
        }
        catch (error) {
            this.logger.warn(`Could not suspend ${workspaceId}: ${error instanceof Error ? error.message : error}`);
        }
    }

    /** Gives the machines back once a workspace has gone a week unused. */
    private async reclaim(workspaceId: Workspace.Id): Promise<void> {
        try {
            if (await this.hardware.hasRunningWorker(workspaceId))
                return;

            await this.workspaces.reclaimCompute(workspaceId);

            this.logger.log(`Reclaimed the machines of ${workspaceId} after a week unused`);
        }
        catch (error) {
            this.logger.warn(`Could not reclaim ${workspaceId}: ${error instanceof Error ? error.message : error}`);
        }
    }

    /** The plans live in the portal database, so they are a separate read. */
    private async getPlans(ids: Workspace.Id[]): Promise<Map<Workspace.Id, Workspace.Plan>> {
        const rows = await PortalDB.asService('read plans for activity sweep', (db) =>
            db.selectFrom('workspaces').select(['id', 'plan']).where('id', 'in', ids).execute());

        return new Map(rows.map((row) => [Workspace.Id.parse(row.id), Workspace.Plan.parse(row.plan)]));
    }
}
