import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Plan } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';

/**
 * Every plan, in memory.
 *
 * Read on the hot paths — the idle sweep asks one per workspace per minute, and
 * the fleet asks again for every machine it builds — so the table is loaded once
 * and re-read only when it changes. Plans change on the order of never.
 */
@Injectable()
export class PlanRegistry implements OnModuleInit {

    private readonly logger = new Logger(PlanRegistry.name);

    private plans = new Map<Plan.Id, Plan>();

    public async onModuleInit(): Promise<void> {
        await this.reload();
    }

    /** The plan, or a throw: a workspace on a plan that does not exist is a bug. */
    public get(planId: Plan.Id): Plan {
        const plan = this.plans.get(planId);

        if (!plan)
            throw new Error(`No such plan: ${planId}`);

        return plan;
    }

    /** The plan, or nothing, for callers that can carry on without one. */
    public find(planId: Plan.Id): Plan | undefined {
        return this.plans.get(planId);
    }

    /** What the payment provider charges for a plan. One with no price is not for sale. */
    public getStripePriceIdForPlan(planId: Plan.Id): string {
        const { stripePriceId } = this.get(planId);

        if (!stripePriceId)
            throw new Error(`Plan ${planId} has no price to charge`);

        return stripePriceId;
    }

    /** The plan a price sells, or nothing if it sells none of ours. */
    public findPlanForStripePriceId(stripePriceId: string): Plan | undefined {
        return [...this.plans.values()].find((plan) => plan.stripePriceId === stripePriceId);
    }

    /** Everything on sale, in the order a pricing page should show it. */
    public list(): Plan[] {
        return [...this.plans.values()]
            .filter((plan) => plan.purchasable)
            .sort((a, b) => a.sortOrder - b.sortOrder);
    }

    /** Everything, including plans written for one customer. */
    public listAll(): Plan[] {
        return [...this.plans.values()].sort((a, b) => a.sortOrder - b.sortOrder);
    }

    /** Called after a plan is written. */
    public async reload(): Promise<void> {
        const rows = await PortalDB.asService('read plans', (db) =>
            db.selectFrom('plans').selectAll().execute());

        this.plans = new Map(rows
            .map((row) => PortalDB.Plan.toDomain(PortalDB.Plan.Row.parse(row)))
            .map((plan) => [plan.id, plan]));

        this.logger.log(`Loaded ${this.plans.size} plans`);
    }
}
