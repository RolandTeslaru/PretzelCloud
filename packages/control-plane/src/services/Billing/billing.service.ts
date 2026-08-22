import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { User, Workspace } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';
import { requireEnv } from '@/db/table';
import { WorkspaceService } from '@/services/Workspace/workspace.service';

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

    /** Where to send someone to pay for a workspace. */
    async checkoutUrl(principal: { userId: User.Id }, workspace: Workspace, plan: Workspace.Plan, returnTo: string): Promise<string> {
        if (plan === 'free')
            throw new Error('Free is not a purchasable plan');

        const customer = await this.customerFor(principal.userId);

        const session = await this.stripe.checkout.sessions.create({
            mode:        'subscription',
            customer,
            line_items:  [{ price: this.priceFor(plan), quantity: 1 }],
            success_url: `${returnTo}?checkout=done`,
            cancel_url:  `${returnTo}?checkout=cancelled`,
            // The only thing tying a payment back to a workspace. One person can
            // own several, on different plans.
            subscription_data: { metadata: { workspaceId: workspace.id } },
            metadata:          { workspaceId: workspace.id },
        });

        if (!session.url)
            throw new Error('Stripe returned a checkout session with no url');

        return session.url;
    }

    /** Where to send someone to change a card, see invoices, or cancel. */
    async portalUrl(principal: { userId: User.Id }, returnTo: string): Promise<string> {
        const customer = await this.customerFor(principal.userId);

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
        const workspaceId = this.workspaceOf(session.metadata);

        if (!workspaceId || typeof session.subscription !== 'string')
            return;

        const subscription = await this.stripe.subscriptions.retrieve(session.subscription);

        await this.record(workspaceId, subscription);

        await this.moveTo(workspaceId, subscription);
    }

    private async onSubscriptionChanged(subscription: Stripe.Subscription): Promise<void> {
        const workspaceId = this.workspaceOf(subscription.metadata);

        if (!workspaceId)
            return;

        await this.record(workspaceId, subscription);

        // Status changes are mirrored, not acted on: a card being retried must
        // not take a workspace down while its owner is fixing it.
        if (subscription.status === 'active' || subscription.status === 'trialing')
            await this.moveTo(workspaceId, subscription);
    }

    private async onSubscriptionEnded(subscription: Stripe.Subscription): Promise<void> {
        const workspaceId = this.workspaceOf(subscription.metadata);

        if (!workspaceId)
            return;

        await this.record(workspaceId, subscription);

        this.logger.warn(`Subscription ended for ${workspaceId}; it keeps its plan until a freeze exists`);
    }

    /** Moves the workspace to the plan its subscription now pays for. */
    private async moveTo(workspaceId: Workspace.Id, subscription: Stripe.Subscription): Promise<void> {
        const plan = this.planFor(subscription);

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
    private async customerFor(userId: User.Id): Promise<string> {
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

    private priceFor(plan: Exclude<Workspace.Plan, 'free'>): string {
        return requireEnv(PRICE_ENV[plan]);
    }

    /** The plan a subscription's price sells, or null if it sells none of ours. */
    private planFor(subscription: Stripe.Subscription): Exclude<Workspace.Plan, 'free'> | null {
        const priceId = subscription.items.data[0]?.price.id;

        if (!priceId)
            return null;

        for (const plan of Object.keys(PRICE_ENV) as Exclude<Workspace.Plan, 'free'>[])
            if (process.env[PRICE_ENV[plan]] === priceId)
                return plan;

        return null;
    }

    private workspaceOf(metadata: Stripe.Metadata | null): Workspace.Id | null {
        const parsed = Workspace.Id.safeParse(metadata?.workspaceId);

        if (!parsed.success)
            this.logger.error('Stripe object carries no workspaceId in its metadata');

        return parsed.success ? parsed.data : null;
    }
}
