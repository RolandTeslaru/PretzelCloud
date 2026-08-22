import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { User, Workspace } from '@pretzel-cloud/shared/domain';
import { Principal } from '@/auth/principal';
import { PortalDB } from '@/db/portal';
import { requireEnv } from '@/db/table';
import { WorkspaceService } from '@/services/Workspace/workspace.service';

/** A subscription in one of these is being paid on; anything else has ended. */
const LIVE_STATUSES: Stripe.Subscription.Status[] = ['active', 'trialing', 'past_due', 'unpaid'];

/** Which price sells which plan. Free is not sold. */
const PRICE_ENV: Record<Exclude<Workspace.Plan, 'free'>, string> = {
    base: 'STRIPE_PRICE_BASE',
    pro:  'STRIPE_PRICE_PRO',
};

/**
 * Everything that talks to Stripe, and nothing that drives a workspace.
 *
 * A plan change here becomes `WorkspaceService.setPlan`, which owns what a plan
 * means: stopping, rebuilding the machines its topology calls for, and starting
 * again. This decides only that it changed, and that Stripe said so.
 */
@Injectable()
export class BillingService {

    private readonly logger = new Logger(BillingService.name);

    private client: Stripe | undefined;

    constructor(private readonly workspaces: WorkspaceService) {}

    // Lazy so a control plane configured without billing still boots.
    private get stripe(): Stripe {
        return this.client ??= new Stripe(requireEnv('STRIPE_SECRET_KEY'));
    }

    /**
     * Puts a workspace on a plan.
     *
     * A workspace already paying for one has its price swapped in place and the
     * difference prorated — a second subscription would be a second bill for the
     * same thing. Only a workspace paying for nothing is sent to a hosted page,
     * and only then is there a url to return.
     */
    async changePlan(principal: Principal.User, workspace: Workspace, plan: Workspace.Plan, returnTo: string): Promise<{ url: string | null }> {
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

    /**
     * The subscription a workspace is actually paying on, or null. A recorded id
     * whose subscription has since ended is not one — that workspace may buy again.
     */
    private async getLiveSubscriptionForWorkspace(workspaceId: Workspace.Id): Promise<Stripe.Subscription | null> {
        const row = await PortalDB.asService('read subscription for workspace', (db) =>
            db.selectFrom('workspaces').select('stripe_subscription_id').where('id', '=', workspaceId).executeTakeFirst());

        if (!row?.stripe_subscription_id)
            return null;

        const subscription = await this.stripe.subscriptions.retrieve(row.stripe_subscription_id).catch(() => null);

        if (!subscription)
            return null;

        return LIVE_STATUSES.includes(subscription.status) ? subscription : null;
    }

    /** Moves an existing subscription onto another plan's price. */
    private async swapPrice(subscription: Stripe.Subscription, plan: Exclude<Workspace.Plan, 'free'>, workspaceId: Workspace.Id): Promise<void> {
        const item = subscription.items.data[0];

        if (!item)
            throw new Error(`Subscription ${subscription.id} has no item to move`);

        await this.stripe.subscriptions.update(subscription.id, {
            items: [{ id: item.id, price: this.getPriceForPlan(plan) }],
            proration_behavior: 'create_prorations',
            // Re-stated because a subscription begun outside checkout may carry none.
            metadata: { workspaceId },
        });
    }

    /** Where to send someone to pay for a workspace. */
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
            // The only thing tying a payment back to a workspace. One person can
            // own several, on different plans.
            subscription_data: { metadata: { workspaceId: workspace.id } },
            metadata:          { workspaceId: workspace.id },
        });

        if (!session.url)
            throw new Error('Stripe returned a checkout session with no url');

        return session.url;
    }

    /** A page per outcome, so each can say its own thing. */
    private getCheckoutOutcomeUrl(origin: string, outcome: 'success' | 'cancelled', workspaceId: Workspace.Id): string {
        return new URL(`/checkout/${outcome}/${workspaceId}`, origin).toString();
    }

    /** Where to send someone to change a card, see invoices, or cancel. */
    async getStripeBillingPortalUrl(principal: Principal.User, returnTo: string): Promise<string> {
        const customer = await this.getStripeCustomerForUser(principal.userId);

        const session = await this.stripe.billingPortal.sessions.create({
            customer,
            return_url: returnTo,
        });

        return session.url;
    }

    /** Verifies a payload came from Stripe, and returns it as an event. */
    constructEvent(payload: Buffer, signature: string): Stripe.Event {
        return this.stripe.webhooks.constructEvent(payload, signature, requireEnv('STRIPE_WEBHOOK_SECRET'));
    }

    /**
     * What a verified event means. Safe to call twice with the same event: the
     * id is recorded first, and a second delivery finds it there.
     */
    async apply(event: Stripe.Event): Promise<void> {
        if (!await this.claim(event.id))
            return;

        try {
            switch (event.type) {
                case 'checkout.session.completed':
                    return await this.onCheckoutCompleted(event.data.object);

                // Created as well as updated: a subscription can begin in the
                // dashboard or over the API, not only through checkout.
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
            // The claim is what makes a retry a no-op, so a failed one has to
            // give it back — otherwise Stripe's retry skips work never done.
            await this.release(event.id);

            throw error;
        }
    }

    private release(eventId: string): Promise<unknown> {
        return PortalDB.asService('release stripe event', (db) =>
            db.deleteFrom('stripe_events').where('id', '=', eventId).execute());
    }

    private async onCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
        const workspaceId = this.getWorkspaceFromSubscriptionMeta(session.metadata);

        if (!workspaceId || typeof session.subscription !== 'string')
            return;

        const subscription = await this.stripe.subscriptions.retrieve(session.subscription);

        await this.record(workspaceId, subscription);

        await this.moveTo(workspaceId, subscription);
    }

    private async onSubscriptionChanged(subscription: Stripe.Subscription): Promise<void> {
        const workspaceId = this.getWorkspaceFromSubscriptionMeta(subscription.metadata);

        if (!workspaceId)
            return;

        await this.record(workspaceId, subscription);

        // Status changes are mirrored, not acted on: a card being retried must
        // not take a workspace down while its owner is fixing it.
        if (subscription.status === 'active' || subscription.status === 'trialing')
            await this.moveTo(workspaceId, subscription);
    }

    private async onSubscriptionEnded(subscription: Stripe.Subscription): Promise<void> {
        const workspaceId = this.getWorkspaceFromSubscriptionMeta(subscription.metadata);

        if (!workspaceId)
            return;

        await this.record(workspaceId, subscription);

        this.logger.warn(`Subscription ended for ${workspaceId}; it keeps its plan until a freeze exists`);
    }

    /** Moves the workspace to the plan its subscription now pays for. */
    private async moveTo(workspaceId: Workspace.Id, subscription: Stripe.Subscription): Promise<void> {
        const plan = this.getPlanForSubscription(subscription);

        if (!plan) {
            this.logger.error(`No plan matches the price on ${subscription.id}`);

            return;
        }

        const row = await PortalDB.asService('read workspace for billing', (db) =>
            db.selectFrom('workspaces').select(['owner_id', 'plan']).where('id', '=', workspaceId).executeTakeFirst());

        if (!row)
            return;

        // Already there. A rebuild for nothing is a stopped workspace for nothing.
        if (row.plan === plan)
            return;

        await this.workspaces.setPlan(workspaceId, User.Id.parse(row.owner_id), plan);
    }

    /** Mirrors Stripe onto the workspace, for display. Stripe stays the record. */
    private record(workspaceId: Workspace.Id, subscription: Stripe.Subscription): Promise<unknown> {
        return PortalDB.asService('record subscription', (db) =>
            db
                .updateTable('workspaces')
                .set({ stripe_subscription_id: subscription.id, subscription_status: subscription.status })
                .where('id', '=', workspaceId)
                .execute());
    }

    /**
     * Records the event id, and says whether this delivery is the one that owns
     * it. Insert-first rather than check-then-write: two deliveries at once
     * would both pass a check.
     */
    private async claim(eventId: string): Promise<boolean> {
        const claimed = await PortalDB.asService('claim stripe event', (db) =>
            db
                .insertInto('stripe_events')
                .values({ id: eventId })
                .onConflict((oc) => oc.column('id').doNothing())
                .returning('id')
                .executeTakeFirst());

        if (!claimed)
            this.logger.debug(`Already handled ${eventId}`);

        return claimed !== undefined;
    }

    /** The customer this person is, creating one the first time they pay. */
    private async getStripeCustomerForUser(userId: User.Id): Promise<string> {
        const user = await PortalDB.asService('read user for billing', (db) =>
            db.selectFrom('users').select(['email', 'display_name', 'stripe_customer_id']).where('id', '=', userId).executeTakeFirstOrThrow());

        if (user.stripe_customer_id)
            return user.stripe_customer_id;

        const customer = await this.stripe.customers.create({
            email: user.email,
            name:  user.display_name,
            metadata: { userId },
        });

        await PortalDB.asService('record stripe customer', (db) =>
            db.updateTable('users').set({ stripe_customer_id: customer.id }).where('id', '=', userId).execute());

        return customer.id;
    }

    private getPriceForPlan(plan: Exclude<Workspace.Plan, 'free'>): string {
        return requireEnv(PRICE_ENV[plan]);
    }

    /** The plan a subscription's price sells, or null if it sells none of ours. */
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
