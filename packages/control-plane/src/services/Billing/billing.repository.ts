import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { User, Workspace } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';
import { Repository, Transactional } from '@/db/repository';
import { Principal } from '@/auth/identity/principal';

/** Stripe stays the record; these are mirrors. */
@Injectable()
export class BillingRepository extends Repository(PortalDB) {

    @Transactional('service')
    public async saveSubscription(principal: Principal.Service, workspaceId: Workspace.Id, subscription: Stripe.Subscription): Promise<void> {
        const item = subscription.items.data[0];

        await this.trx
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

    @Transactional('service')
    public getOwnerAndPlanIdForWorkspace(principal: Principal.Service, workspaceId: Workspace.Id) {
        return this.trx
            .selectFrom('workspaces')
            .select(['owner_id', 'plan_id'])
            .where('id', '=', workspaceId)
            .executeTakeFirst();
    }

    @Transactional('service')
    public async getSubscriptionId(principal: Principal.Service, workspaceId: Workspace.Id): Promise<string | null> {
        const row = await this.trx
            .selectFrom('workspaces')
            .select('stripe_subscription_id')
            .where('id', '=', workspaceId)
            .executeTakeFirst();

        return row?.stripe_subscription_id ?? null;
    }

    @Transactional('service')
    public getCustomerFields(principal: Principal.Service, userId: User.Id) {
        return this.trx
            .selectFrom('users')
            .select(['email', 'display_name', 'stripe_customer_id'])
            .where('id', '=', userId)
            .executeTakeFirstOrThrow();
    }

    @Transactional('service')
    public async saveCustomerId(principal: Principal.Service, userId: User.Id, customerId: string): Promise<void> {
        await this.trx
            .updateTable('users')
            .set({ stripe_customer_id: customerId })
            .where('id', '=', userId)
            .execute();
    }

    // Insert-first: two deliveries at once would both pass a check.
    @Transactional('service')
    public async claimEvent(principal: Principal.Service, eventId: string): Promise<boolean> {
        const claimed = await this.trx
            .insertInto('stripe_events')
            .values({ id: eventId })
            .onConflict((oc) => oc.column('id').doNothing())
            .returning('id')
            .executeTakeFirst();

        return claimed !== undefined;
    }

    @Transactional('service')
    public async releaseEvent(principal: Principal.Service, eventId: string): Promise<void> {
        await this.trx
            .deleteFrom('stripe_events')
            .where('id', '=', eventId)
            .execute();
    }
}
