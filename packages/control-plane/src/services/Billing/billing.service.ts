import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { Plan, User, Workspace } from '@pretzel-cloud/shared/domain';
import { Principal } from '@/auth/identity/principal';
import { BillingRepository } from './billing.repository';
import { StripeClient } from './stripe.client';
import { PlanRegistry } from '@/services/Plan/plan.registry';

/** A subscription in one of these is being paid on; anything else has ended. */
const LIVE_STATUSES: Stripe.Subscription.Status[] = ['active', 'trialing', 'past_due', 'unpaid'];

/**
 * What the fleet asks of Stripe: checkouts, price swaps, cancellations. What
 * Stripe asks of the fleet is StripeEventHandlerService.
 */
@Injectable()
export class BillingService {

    private readonly logger = new Logger(BillingService.name);

    constructor(
        private readonly stripeClient: StripeClient,
        private readonly billingRepository: BillingRepository,
        private readonly planRegistry:     PlanRegistry,
    ) {}


    private get stripe(): Stripe {
        return this.stripeClient.client;
    }

    /**
     * Puts a workspace on a plan. One already paying has its price swapped in
     * place and prorated; a second subscription would be a second bill.
     */
    public async changePlan(principal: Principal.User, workspaceId: Workspace.Id, planId: Plan.Id, returnTo: string): Promise<{ url: string | null }> {
        if (!this.planRegistry.get(planId).purchasable)
            throw new Error(`Plan ${planId} is not for sale`);

        const existing = await this.getLiveSubscriptionForWorkspace(workspaceId);

        if (existing) {
            await this.setPriceForSubscription(existing, planId, workspaceId);

            // The plan still moves through the webhook, so there is one path from
            // "Stripe says so" to the machines being rebuilt.
            return { url: null };
        }

        return { url: await this.getStripeCheckoutUrl(principal, workspaceId, planId, returnTo) };
    }

    /** What it is actually paying on. A recorded id that has ended is not one. */
    private async getLiveSubscriptionForWorkspace(workspaceId: Workspace.Id): Promise<Stripe.Subscription | null> {
        const subscriptionId = await this.billingRepository.getSubscriptionId(Principal.SELF, workspaceId);

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
    private async setPriceForSubscription(subscription: Stripe.Subscription, planId: Plan.Id, workspaceId: Workspace.Id): Promise<void> {
        const item = subscription.items.data[0];

        if (!item)
            throw new Error(`Subscription ${subscription.id} has no item to move`);

        await this.stripe.subscriptions.update(subscription.id, {
            items: [{ id: item.id, price: this.planRegistry.getStripePriceIdForPlan(planId) }],
            proration_behavior: 'create_prorations',
            // A subscription begun outside checkout may carry none.
            metadata: { workspaceId },
        });
    }

    /** For a first subscription only; a change never reaches here. */
    private async getStripeCheckoutUrl(principal: Principal.User, workspaceId: Workspace.Id, planId: Plan.Id, returnTo: string): Promise<string> {
        const customer = await this.getStripeCustomerForUser(principal.userId);

        const priceId = this.planRegistry.getStripePriceIdForPlan(planId)

        const session = await this.stripe.checkout.sessions.create({
            mode:        'subscription',
            customer,
            line_items:  [{ price: priceId, quantity: 1 }],
            success_url: this.getCheckoutOutcomeUrl(returnTo, 'success', workspaceId),
            cancel_url:  this.getCheckoutOutcomeUrl(returnTo, 'cancelled', workspaceId),
            // The only thing tying a payment back to a workspace.
            subscription_data: { metadata: { workspaceId } },
            metadata:          { workspaceId },
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

    /** Created the first time they pay, then remembered. */
    private async getStripeCustomerForUser(userId: User.Id): Promise<string> {
        const user = await this.billingRepository.getCustomerFields(Principal.SELF, userId);

        if (user.stripe_customer_id)
            return user.stripe_customer_id;

        const customer = await this.stripe.customers.create({
            email: user.email,
            name:  user.display_name,
            metadata: { userId },
        });

        await this.billingRepository.saveCustomerId(Principal.SELF, userId, customer.id);

        return customer.id;
    }

}
