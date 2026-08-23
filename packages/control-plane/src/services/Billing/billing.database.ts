import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { User, Workspace } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';
import { AllowedDatabaseRoles, DatabaseClass } from '@/decorators/database';

type Trx = PortalDB.ServiceTransaction;

/** Stripe stays the record; these are mirrors. */
@Injectable()
@DatabaseClass
export class BillingDatabase {

    @AllowedDatabaseRoles('service')
    public async saveSubscription(trx: Trx, workspaceId: Workspace.Id, subscription: Stripe.Subscription): Promise<void> {
        const item = subscription.items.data[0];

        await trx
            .updateTable('workspaces')
            .set({
                stripe_subscription_id: subscription.id,
                subscription_status:    subscription.status,
                // Read back rather than assumed: a mid-cycle swap moves it.
                current_period_start: item ? new Date(item.current_period_start * 1000) : null,
                current_period_end:   item ? new Date(item.current_period_end   * 1000) : null,
            })
            .where('id', '=', workspaceId)
            .execute();
    }

    @AllowedDatabaseRoles('service')
    public getWorkspacePlan(trx: Trx, workspaceId: Workspace.Id) {
        return trx
            .selectFrom('workspaces')
            .select(['owner_id', 'plan'])
            .where('id', '=', workspaceId)
            .executeTakeFirst();
    }

    @AllowedDatabaseRoles('service')
    public async getSubscriptionId(trx: Trx, workspaceId: Workspace.Id): Promise<string | null> {
        const row = await trx
            .selectFrom('workspaces')
            .select('stripe_subscription_id')
            .where('id', '=', workspaceId)
            .executeTakeFirst();

        return row?.stripe_subscription_id ?? null;
    }

    @AllowedDatabaseRoles('service')
    public getCustomerFields(trx: Trx, userId: User.Id) {
        return trx
            .selectFrom('users')
            .select(['email', 'display_name', 'stripe_customer_id'])
            .where('id', '=', userId)
            .executeTakeFirstOrThrow();
    }

    @AllowedDatabaseRoles('service')
    public async saveCustomerId(trx: Trx, userId: User.Id, customerId: string): Promise<void> {
        await trx
            .updateTable('users')
            .set({ stripe_customer_id: customerId })
            .where('id', '=', userId)
            .execute();
    }

    // Insert-first: two deliveries at once would both pass a check.
    @AllowedDatabaseRoles('service')
    public async claimEvent(trx: Trx, eventId: string): Promise<boolean> {
        const claimed = await trx
            .insertInto('stripe_events')
            .values({ id: eventId })
            .onConflict((oc) => oc.column('id').doNothing())
            .returning('id')
            .executeTakeFirst();

        return claimed !== undefined;
    }

    @AllowedDatabaseRoles('service')
    public async releaseEvent(trx: Trx, eventId: string): Promise<void> {
        await trx
            .deleteFrom('stripe_events')
            .where('id', '=', eventId)
            .execute();
    }
}
