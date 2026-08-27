import { Injectable, Logger } from '@nestjs/common';
import { Plan, Workspace } from '@pretzel-cloud/shared/domain';
import { FleetDB } from '@/db/fleet';
import { PortalDB } from '@/db/portal';
import { PlanRegistry } from '@/services/Plan/plan.registry';
import { UsageDatabase } from './usage.database';

const LIST_LIMIT = 200;

// How long a locked workspace is refused from memory before the period is read
// again. Only a new period unlocks one, so staleness costs it nothing.
const RECHECK_MS = 60_000;

/**
 * What a plan allows a workspace, and how much of it is spent. Measured by the
 * fleet: a workspace's own database belongs to the payer.
 *
 * Grouped by what is being spent, so the kind is said once and the members read
 * plainly — `entitlements.executions.getCount(…)`. Uptime joins as its own group.
 */
@Injectable()
export class EntitlementService {

    private readonly logger = new Logger(EntitlementService.name);

    constructor(
        private readonly usageDatabase: UsageDatabase,
        private readonly planRegistry: PlanRegistry,
    ) {}

    /** Workspaces known to be over, and when each was last confirmed. */
    private readonly locked = new Map<Workspace.Id, number>();

    public readonly executions = {

        /** How many have run in a period. */
        getCount: (workspaceId: Workspace.Id, period: Workspace.Usage.Period): Promise<number> =>
            FleetDB.asService('count executions', (trx) =>
                this.usageDatabase.executions.getCountIn(trx, workspaceId, period)),

        /** The same for many, over one period, so a grid stays one query. */
        getCounts: async (workspaceIds: Workspace.Id[], period: Workspace.Usage.Period): Promise<Map<Workspace.Id, number>> => {
            const rows = await FleetDB.asService('count executions for many', (trx) =>
                this.usageDatabase.executions.getCountsIn(trx, workspaceIds, period));

            return new Map(rows.map((row) => [row.workspace_id as Workspace.Id, Number(row.count)]));
        },

        /** Executions per day over a period, days with none omitted. */
        getDailyCounts: (workspaceId: Workspace.Id, period: Workspace.Usage.Period): Promise<Workspace.Usage.Point[]> =>
            FleetDB.asService('count executions by day', (trx) =>
                this.usageDatabase.executions.getDailyCounts(trx, workspaceId, period)),

        /** The rows behind the count, newest first. */
        get: (workspaceId: Workspace.Id, period: Workspace.Usage.Period, limit = LIST_LIMIT): Promise<Workspace.Usage[]> =>
            FleetDB.asService('list executions', (trx) =>
                this.usageDatabase.executions.getIn(trx, workspaceId, period, limit)),

        /**
         * Records one and locks the workspace when that was its last. A single
         * round trip: the insert answers with the period's total.
         */
        recordAndLockIfOver: async (workspaceId: Workspace.Id, executionId: string | null, igniter: string | null): Promise<void> => {
            const allowance = await this.executions.getAllowance(workspaceId);

            const used = await FleetDB.asService('record execution', (trx) =>
                this.usageDatabase.executions.insertAndGetCount(trx, {
                    workspaceId,
                    executionId,
                    igniter,
                    period: Workspace.Usage.getCurrentPeriod(allowance?.periodStart ?? null, allowance?.periodEnd ?? null),
                }));

            if (!allowance || allowance.limit === null)
                return;

            if (used >= allowance.limit) {
                this.locked.set(workspaceId, Date.now());

                this.logger.log(`${workspaceId} has used ${used} of ${allowance.limit} executions`);
            }
        },

        /** The plan's limit, and the period it applies over. */
        getAllowance: async (workspaceId: Workspace.Id): Promise<Workspace.Usage.Allowance | null> => {
            const row = await PortalDB.asService('read execution allowance', (db) =>
                db
                    .selectFrom('workspaces')
                    .select(['plan_id', 'current_period_start', 'current_period_end'])
                    .where('id', '=', workspaceId)
                    .executeTakeFirst());

            if (!row)
                return null;

            const plan = this.planRegistry.find(row.plan_id as Plan.Id);

            return {
                limit:       plan?.maxExecutionsMonthly ?? null,
                periodStart: row.current_period_start,
                periodEnd:   row.current_period_end,
            };
        },

        /** Whether another fits. A null limit is unlimited and costs no query. */
        isWithinLimit: async (workspaceId: Workspace.Id, plan: Plan, period: Workspace.Usage.Period): Promise<boolean> => {
            if (plan.maxExecutionsMonthly === null)
                return true;

            const used = await this.executions.getCount(workspaceId, period);

            return Workspace.Usage.isWithinLimit(used, plan.maxExecutionsMonthly);
        },

        /** What is left, or null when nothing bounds it. */
        getRemaining: async (workspaceId: Workspace.Id, plan: Plan, period: Workspace.Usage.Period): Promise<number | null> => {
            if (plan.maxExecutionsMonthly === null)
                return null;

            const used = await this.executions.getCount(workspaceId, period);

            return Workspace.Usage.getRemaining(used, plan.maxExecutionsMonthly);
        },
    };

    /** The period a workspace is being billed over right now. */
    public async getBillingPeriod(workspaceId: Workspace.Id): Promise<Workspace.Usage.Period> {
        const allowance = await this.executions.getAllowance(workspaceId);

        return Workspace.Usage.getCurrentPeriod(allowance?.periodStart ?? null, allowance?.periodEnd ?? null);
    }

    /** Where a workspace stands in the period it is being billed over. */
    public async getPeriodUsageReport(workspaceId: Workspace.Id): Promise<Workspace.Usage.Report> {
        const allowance = await this.executions.getAllowance(workspaceId);
        const period    = Workspace.Usage.getCurrentPeriod(allowance?.periodStart ?? null, allowance?.periodEnd ?? null);
        const limit     = allowance?.limit ?? null;
        const used      = await this.executions.getCount(workspaceId, period);

        return { period, used, limit, remaining: Workspace.Usage.getRemaining(used, limit) };
    }

    /**
     * Whether this workspace is out of executions. Answers from memory, and only
     * re-reads once a locked one has been refused for a while — the request it
     * refuses was never going to run.
     */
    public async isLocked(workspaceId: Workspace.Id): Promise<boolean> {
        const confirmedAt = this.locked.get(workspaceId);

        if (confirmedAt === undefined)
            return false;

        if (Date.now() - confirmedAt < RECHECK_MS)
            return true;

        const allowance = await this.executions.getAllowance(workspaceId);
        const used      = allowance
            ? await this.executions.getCount(workspaceId, Workspace.Usage.getCurrentPeriod(allowance.periodStart, allowance.periodEnd))
            : 0;

        if (!allowance || Workspace.Usage.isWithinLimit(used, allowance.limit)) {
            this.locked.delete(workspaceId);

            return false;
        }

        this.locked.set(workspaceId, Date.now());

        return true;
    }

    /** Lets a workspace through again, for a plan change that raised its limit. */
    public unlock(workspaceId: Workspace.Id): void {
        this.locked.delete(workspaceId);
    }

    /** Newest first, across the workspaces the caller may see. */
    public getRecentUsage(workspaceIds: Workspace.Id[], limit = LIST_LIMIT): Promise<Workspace.Usage[]> {
        return FleetDB.asService('list usage', (trx) => this.usageDatabase.executions.getRecent(trx, workspaceIds, limit));
    }
}
