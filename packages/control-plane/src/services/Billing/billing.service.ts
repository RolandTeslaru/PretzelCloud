import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { User, Workspace } from '@pretzel-cloud/shared/domain';
import { Principal } from '@/auth/principal';
import { requireEnv } from '@/db/table';
import { WorkspaceService } from '@/services/Workspace/workspace.service';
import { BillingDatabase } from './billing.database';

/** A subscription in one of these is being paid on; anything else has ended. */
const LIVE_STATUSES: Stripe.Subscription.Status[] = ['active', 'trialing', 'past_due', 'unpaid'];

/** Which price sells which plan. Free is not sold. */
const PRICE_ENV: Record<Exclude<Workspace.Plan, 'free'>, string> = {
    base: 'STRIPE_PRICE_BASE',
    pro:  'STRIPE_PRICE_PRO',
};

/**
 * Everything that talks to Stripe, and nothing that drives a workspace. A plan
 * change here becomes `setPlan`, which owns what a plan means.
 */
@Injectable()
export class BillingService {

    private readonly logger = new Logger(BillingService.name);

    client: Stripe | undefined;

    constructor(
        private readonly workspaces: WorkspaceService,
        private readonly db: BillingDatabase,
    ) {}

    // Lazy so a control plane configured without billing still boots.
    private get stripe(): Stripe {
        return this.client ??= new Stripe(requireEnv('STRIPE_SECRET_KEY'));
    }

    /**
     * Puts a workspace on a plan. One already paying has its price swapped in
     * place and prorated; a second subscription would be a second bill.
     */
    public async changePlan(principal: Principal.User, workspace: Workspace, plan: Workspace.Plan, returnTo: string): Promise<{ url: string | null }> {
        if (plan === 'free')
            throw new Error('Free is not a purchasable plan');

        const existing = await this.getLiveSubscriptionForWorkspace(workspace.id);

        if (existing) {
            await this.swapPrice(existing, plan, workspace.id);

            // The plan still moves through the webhook, so there is one path from
            // "Stripe says so" to the machines being rebuilt.
            return { url: null };
        }

        return { url: await this.getStripeCheckoutUrl(principal, workspace, plan, returnTo) };
    }

    /** What it is actually paying on. A recorded id that has ended is not one. */
    private async getLiveSubscriptionForWorkspace(workspaceId: Workspace.Id): Promise<Stripe.Subscription | null> {
        const subscriptionId = await this.db.getSubscriptionId(workspaceId);

        if (!subscriptionId)
            return null;

        const subscription = await this.stripe.subscriptions.retrieve(subscriptionId).catch(() => null);

        if (!subscription)
            return null;

        return LIVE_STATUSES.includes(subscription.status) ? subscription : null;
    }

    /**
     * Ends what a workspace is paying, now rather than at the period's end —
     * the thing being paid for is going away. Silent when nothing is live, so a
     * free workspace and a lapsed one both simply pass through.
     */
    public async cancelSubscription(workspaceId: Workspace.Id): Promise<void> {
        const subscription = await this.getLiveSubscriptionForWorkspace(workspaceId);

        if (!subscription)
            return;

        await this.stripe.subscriptions.cancel(subscription.id);

        this.logger.log(`cancelled ${subscription.id} for ${workspaceId}`);
    }

    /** Moves an existing subscription onto another plan's price. */
    private async swapPrice(subscription: Stripe.Subscription, plan: Exclude<Workspace.Plan, 'free'>, workspaceId: Workspace.Id): Promise<void> {
        const item = subscription.items.data[0];

        if (!item)
            throw new Error(`Subscription ${subscription.id} has no item to move`);

        await this.stripe.subscriptions.update(subscription.id, {
            items: [{ id: item.id, price: this.getPriceForPlan(plan) }],
            proration_behavior: 'create_prorations',
            // A subscription begun outside checkout may carry none.
            metadata: { workspaceId },
        });
    }

    /** For a first subscription only; a change never reaches here. */
    private async getStripeCheckoutUrl(principal: Principal.User, workspace: Workspace, plan: Workspace.Plan, returnTo: string): Promise<string> {
        if (plan === 'free')
            throw new Error('Free is not a purchasable plan');

        const customer = await this.getStripeCustomerForUser(principal.userId);

        const session = await this.stripe.checkout.sessions.create({
            mode:        'subscription',
            customer,
            line_items:  [{ price: this.getPriceForPlan(plan), quantity: 1 }],
            success_url: this.getCheckoutOutcomeUrl(returnTo, 'success', workspace.id),
            cancel_url:  this.getCheckoutOutcomeUrl(returnTo, 'cancelled', workspace.id),
            // The only thing tying a payment back to a workspace.
            subscription_data: { metadata: { workspaceId: workspace.id } },
            metadata:          { workspaceId: workspace.id },
        });

        if (!session.url)
            throw new Error('Stripe returned a checkout session with no url');

        return session.url;
    }

    /** A page per outcome. */
    private getCheckoutOutcomeUrl(origin: string, outcome: 'success' | 'cancelled', workspaceId: Workspace.Id): string {
        return new URL(`/checkout/${outcome}/${workspaceId}`, origin).toString();
    }

    /** Where to send someone to change a card, see invoices, or cancel. */
    public async getStripeBillingPortalUrl(principal: Principal.User, returnTo: string): Promise<string> {
        const customer = await this.getStripeCustomerForUser(principal.userId);

        const session = await this.stripe.billingPortal.sessions.create({
            customer,
            return_url: returnTo,
        });

        return session.url;
    }

    /** Verifies a payload came from Stripe, and returns it as an event. */
    public constructEvent(payload: Buffer, signature: string): Stripe.Event {
        return this.stripe.webhooks.constructEvent(payload, signature, requireEnv('STRIPE_WEBHOOK_SECRET'));
    }

    /** What a verified event means. Safe to call twice with the same one. */
    public async apply(event: Stripe.Event): Promise<void> {
        if (!await this.db.claimEvent(event.id))
            return;

        try {
            switch (event.type) {
                case 'checkout.session.completed':
                    return await this.onCheckoutCompleted(event.data.object);

                // A subscription can begin in the dashboard or over the API too.
                case 'customer.subscription.created':
                case 'customer.subscription.updated':
                    return await this.onSubscriptionChanged(event.data.object);

                case 'customer.subscription.deleted':
                    return await this.onSubscriptionEnded(event.data.object);

                default:
                    this.logger.debug(`Ignoring ${event.type}`);
            }
        }
        catch (error) {
            // The claim makes a retry a no-op, so a failure must give it back.
            await this.db.releaseEvent(event.id);

            throw error;
        }
    }

    private async onCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
        const workspaceId = this.getWorkspaceFromSubscriptionMeta(session.metadata);

        if (!workspaceId || typeof session.subscription !== 'string')
            return;

        const subscription = await this.stripe.subscriptions.retrieve(session.subscription);

        await this.db.saveSubscription(workspaceId, subscription);

        await this.changeWorkspaceSubscription(workspaceId, subscription);
    }

    private async onSubscriptionChanged(subscription: Stripe.Subscription): Promise<void> {
        const workspaceId = this.getWorkspaceFromSubscriptionMeta(subscription.metadata);

        if (!workspaceId)
            return;

        await this.db.saveSubscription(workspaceId, subscription);

        // A card being retried must not take a workspace down mid-fix.
        if (subscription.status === 'active' || subscription.status === 'trialing')
            await this.changeWorkspaceSubscription(workspaceId, subscription);
    }

    private async onSubscriptionEnded(subscription: Stripe.Subscription): Promise<void> {
        const workspaceId = this.getWorkspaceFromSubscriptionMeta(subscription.metadata);

        if (!workspaceId)
            return;

        await this.db.saveSubscription(workspaceId, subscription);

        this.logger.warn(`Subscription ended for ${workspaceId}; it keeps its plan until a freeze exists`);
    }

    /** Moves the workspace to the plan its subscription now pays for. */
    private async changeWorkspaceSubscription(workspaceId: Workspace.Id, subscription: Stripe.Subscription): Promise<void> {
        const plan = this.getPlanForSubscription(subscription);

        if (!plan) {
            this.logger.error(`No plan matches the price on ${subscription.id}`);

            return;
        }

        const row = await this.db.getWorkspacePlan(workspaceId);

        if (!row)
            return;

        // A rebuild for nothing is a stopped workspace for nothing.
        if (row.plan === plan)
            return;

        await this.workspaces.setPlan(workspaceId, User.Id.parse(row.owner_id), plan);
    }

    /** Created the first time they pay, then remembered. */
    private async getStripeCustomerForUser(userId: User.Id): Promise<string> {
        const user = await this.db.getCustomerFields(userId);

        if (user.stripe_customer_id)
            return user.stripe_customer_id;

        const customer = await this.stripe.customers.create({
            email: user.email,
            name:  user.display_name,
            metadata: { userId },
        });

        await this.db.saveCustomerId(userId, customer.id);

        return customer.id;
    }

    private getPriceForPlan(plan: Exclude<Workspace.Plan, 'free'>): string {
        return requireEnv(PRICE_ENV[plan]);
    }

    /** The plan a price sells, or null if it sells none of ours. */
    private getPlanForSubscription(subscription: Stripe.Subscription): Exclude<Workspace.Plan, 'free'> | null {
        const priceId = subscription.items.data[0]?.price.id;

        if (!priceId)
            return null;

        for (const plan of Object.keys(PRICE_ENV) as Exclude<Workspace.Plan, 'free'>[])
            if (process.env[PRICE_ENV[plan]] === priceId)
                return plan;

        return null;
    }

    private getWorkspaceFromSubscriptionMeta(metadata: Stripe.Metadata | null): Workspace.Id | null {
        const parsed = Workspace.Id.safeParse(metadata?.workspaceId);

        if (!parsed.success)
            this.logger.error('Stripe object carries no workspaceId in its metadata');

        return parsed.success ? parsed.data : null;
    }
}
