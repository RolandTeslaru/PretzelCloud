import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { Plan, User, Workspace } from '@pretzel-cloud/shared/domain';
import { requireEnv } from '@/db/table';
import { PortalDB } from '@/db/portal';
import { WorkspaceService } from '@/services/Workspace/workspace.service';
import { BillingDatabase } from './billing.database';
import { StripeClient } from './stripe.client';
import { PlanRegistry } from '@/services/Plan/plan.registry';

/**
 * What Stripe tells the fleet, and what it means here. Nothing in this file
 * asks Stripe for anything — that is BillingService, and the two are separate
 * because only one of them is entered from outside.
 */
@Injectable()
export class StripeEventHandlerService {

    private readonly logger = new Logger(StripeEventHandlerService.name);

    constructor(
        private readonly stripeClient: StripeClient,
        private readonly workspaceService: WorkspaceService,
        private readonly billingDatabase: BillingDatabase,
        private readonly planRegistry:    PlanRegistry,
    ) { }

    /** The plan a subscription's price sells, or null if it sells none of ours. */
    private getPlanIdForSubscription(subscription: Stripe.Subscription): Plan.Id | null {
        const priceId = subscription.items.data[0]?.price.id;

        if (!priceId)
            return null;

        const plan = this.planRegistry.findPlanForStripePriceId(priceId);

        return plan ? plan.id : null;
    }

    private get stripe(): Stripe {
        return this.stripeClient.client;
    }

    /** Verifies a payload came from Stripe, and returns it as an event. */
    public constructEvent(payload: Buffer, signature: string): Stripe.Event {
        return this.stripe.webhooks.constructEvent(payload, signature, requireEnv('STRIPE_WEBHOOK_SECRET'));
    }

    /** What a verified event means. Safe to call twice with the same one. */
    public async handleEvent(event: Stripe.Event): Promise<void> {
        if (!await PortalDB.asService('claim stripe event', (trx) => this.billingDatabase.claimEvent(trx, event.id)))
            return;

        try {
            switch (event.type) {
                case 'checkout.session.completed':
                    return await this.lifecycle.onCheckoutCompleted(event.data.object);

                // A subscription can begin in the dashboard or over the API too.
                case 'customer.subscription.created':
                case 'customer.subscription.updated':
                    return await this.lifecycle.onSubscriptionChanged(event.data.object);

                case 'customer.subscription.deleted':
                    return await this.lifecycle.onSubscriptionEnded(event.data.object);

                default:
                    this.logger.debug(`Ignoring ${event.type}`);
            }
        }
        catch (error) {
            // The claim makes a retry a no-op, so a failure must give it back.
            await PortalDB.asService('release stripe event', (trx) => this.billingDatabase.releaseEvent(trx, event.id));

            throw error;
        }
    }


    /**
     * What each event Stripe sends means for the workspace paying with it. Kept
     * together because the switch above is the only thing that calls them, and
     * apart they read as unrelated methods on a service that has others.
     */
    private readonly lifecycle = {

        onCheckoutCompleted: async (session: Stripe.Checkout.Session): Promise<void> => {
            const workspaceId = this.getWorkspaceFromSubscriptionMeta(session.metadata);

            if (!workspaceId || typeof session.subscription !== 'string')
                return;

            const subscription = await this.stripe.subscriptions.retrieve(session.subscription);

            await PortalDB.asService('save subscription', (trx) => this.billingDatabase.saveSubscription(trx, workspaceId, subscription));

            // Buying again is how a disabled workspace comes back, so this path says
            // so rather than leaving it to the subscription event that follows.
            await this.workspaceService.enable(workspaceId);

            await this.changeWorkspaceSubscription(workspaceId, subscription);
        },

        onSubscriptionChanged: async (subscription: Stripe.Subscription): Promise<void> => {
            const workspaceId = this.getWorkspaceFromSubscriptionMeta(subscription.metadata);

            if (!workspaceId)
                return;

            await PortalDB.asService('save subscription', (trx) => this.billingDatabase.saveSubscription(trx, workspaceId, subscription));

            // `past_due` is deliberately absent: the card is still being retried,
            // and taking a workspace down mid-retry is the wrong call.
            if (subscription.status === 'active' || subscription.status === 'trialing') {
                await this.workspaceService.enable(workspaceId);

                await this.changeWorkspaceSubscription(workspaceId, subscription);

                return;
            }

            // Retries are exhausted. Which terminal action the account is set to
            // decides whether a deletion follows, so this cannot wait for one.
            if (subscription.status === 'unpaid') {
                await this.workspaceService.disable(workspaceId, 'The last invoice for this workspace was not paid.');

                this.logger.log(`Froze ${workspaceId}: its invoice went unpaid`);
            }
        },

        onSubscriptionEnded: async (subscription: Stripe.Subscription): Promise<void> => {
            const workspaceId = this.getWorkspaceFromSubscriptionMeta(subscription.metadata);

            if (!workspaceId)
                return;

            await PortalDB.asService('save subscription', (trx) => this.billingDatabase.saveSubscription(trx, workspaceId, subscription));

            // The plan stays on the row: what they bought is what they come back to,
            // and dropping them to free here would silently rebuild their machines
            // at a smaller size before anyone has decided that is what they want.
            await this.workspaceService.disable(workspaceId, 'The subscription paying for this workspace has ended.');

            this.logger.log(`Froze ${workspaceId}: its subscription ended`);
        },

    };





    /** Moves the workspace to the plan its subscription now pays for. */
    private async changeWorkspaceSubscription(workspaceId: Workspace.Id, subscription: Stripe.Subscription): Promise<void> {
        const planId = this.getPlanIdForSubscription(subscription);

        if (!planId) {
            this.logger.error(`No plan matches the price on ${subscription.id}`);

            return;
        }

        const row = await PortalDB.asService('read workspace plan', (trx) => this.billingDatabase.getOwnerAndPlanIdForWorkspace(trx, workspaceId));

        if (!row)
            return;

        // A rebuild for nothing is a stopped workspace for nothing.
        if (row.plan_id === planId)
            return;

        // Detached: rebuilding machines outlasts what Stripe will wait for, and a
        // delivery it gives up on is redelivered. Caught here because nothing is
        // left on the stack to catch it by the time it fails.
        void this.workspaceService.setPlan(workspaceId, row.owner_id as User.Id, planId)
            .catch((error: unknown) => this.logger.error(
                `Moving ${workspaceId} to ${planId} failed: ${error instanceof Error ? error.message : error}`,
            ));
    }



    
    private getWorkspaceFromSubscriptionMeta(metadata: Stripe.Metadata | null): Workspace.Id | null {
        const parsed = Workspace.Id.safeParse(metadata?.workspaceId);

        if (!parsed.success)
            this.logger.error('Stripe object carries no workspaceId in its metadata');

        return parsed.success ? parsed.data : null;
    }
}
