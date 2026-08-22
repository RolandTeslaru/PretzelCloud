import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { User, Workspace } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';

/** Row operations behind billing. Stripe stays the record; these are mirrors. */
@Injectable()
export class BillingDatabase {

    /** Mirrors a subscription onto the workspace it pays for. */
    public async saveSubscription(workspaceId: Workspace.Id, subscription: Stripe.Subscription): Promise<void> {
        const item = subscription.items.data[0];

        await PortalDB.asService('save subscription', (db) =>
            db
                .updateTable('workspaces')
                .set({
                    stripe_subscription_id: subscription.id,
                    subscription_status:    subscription.status,
                    // The window usage is counted over. It moves when a plan is
                    // swapped mid-cycle, so it is read back rather than assumed.
                    current_period_start: item ? new Date(item.current_period_start * 1000) : null,
                    current_period_end:   item ? new Date(item.current_period_end   * 1000) : null,
                })
                .where('id', '=', workspaceId)
                .execute());
    }

    /** The plan a workspace holds, and who owns it. */
    public getWorkspacePlan(workspaceId: Workspace.Id) {
        return PortalDB.asService('read workspace plan', (db) =>
            db
                .selectFrom('workspaces')
                .select(['owner_id', 'plan'])
                .where('id', '=', workspaceId)
                .executeTakeFirst());
    }

    /** The subscription recorded against a workspace, if any. */
    public async getSubscriptionId(workspaceId: Workspace.Id): Promise<string | null> {
        const row = await PortalDB.asService('read subscription id', (db) =>
            db
                .selectFrom('workspaces')
                .select('stripe_subscription_id')
                .where('id', '=', workspaceId)
                .executeTakeFirst());

        return row?.stripe_subscription_id ?? null;
    }

    /** Who to bill, and what to call them. */
    public getCustomerFields(userId: User.Id) {
        return PortalDB.asService('read user for billing', (db) =>
            db
                .selectFrom('users')
                .select(['email', 'display_name', 'stripe_customer_id'])
                .where('id', '=', userId)
                .executeTakeFirstOrThrow());
    }

    public async saveCustomerId(userId: User.Id, customerId: string): Promise<void> {
        await PortalDB.asService('save stripe customer', (db) =>
            db.updateTable('users').set({ stripe_customer_id: customerId }).where('id', '=', userId).execute());
    }

    /**
     * Claims an event id, and says whether this delivery owns it. Insert-first
     * rather than check-then-write: two deliveries at once would both pass a check.
     */
    public async claimEvent(eventId: string): Promise<boolean> {
        const claimed = await PortalDB.asService('claim stripe event', (db) =>
            db
                .insertInto('stripe_events')
                .values({ id: eventId })
                .onConflict((oc) => oc.column('id').doNothing())
                .returning('id')
                .executeTakeFirst());

        return claimed !== undefined;
    }

    /** Gives a claim back, so a retry does the work this delivery failed at. */
    public async releaseEvent(eventId: string): Promise<void> {
        await PortalDB.asService('release stripe event', (db) =>
            db.deleteFrom('stripe_events').where('id', '=', eventId).execute());
    }
}
