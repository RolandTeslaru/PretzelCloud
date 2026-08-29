import { Injectable } from '@nestjs/common';
import { Plan, User, Workspace } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';
import { AllowedDatabaseRoles, DatabaseClass } from '@/decorators/database';
import { PlanRegistry } from '@/services/Plan/plan.registry';

type UserTrx    = PortalDB.UserTransaction;
type ServiceTrx = PortalDB.ServiceTransaction;

@Injectable()
@DatabaseClass
export class WorkspaceDatabase {

    constructor(private readonly planRegistry: PlanRegistry) {}

    @AllowedDatabaseRoles('service')
    public async insert(trx: ServiceTrx, values: {
        id:          Workspace.Id;
        displayName: string;
        ownerId:     User.Id;
    }): Promise<Workspace> {
        const row = await trx
            .insertInto('workspaces')
            .values({
                id:              values.id,
                subdomain:       null,
                display_name:    values.displayName,
                lifecycle_state: 'creating',
                plan_id:         Plan.DEFAULT_PLAN_ID,
                owner_id:        values.ownerId,
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        await trx
            .insertInto('workspace_members')
            .values({ workspace_id: values.id, user_id: values.ownerId })
            .execute();

        const workspaceRow = PortalDB.Workspace.Row.parse(row);

        const plan = this.planRegistry.get(workspaceRow.plan_id);

        return PortalDB.Workspace.toDomain(workspaceRow, plan);
    }

    @AllowedDatabaseRoles('service')
    public async get(trx: ServiceTrx, workspaceId: Workspace.Id): Promise<Workspace> {
        const row = await trx
            .selectFrom('workspaces')
            .selectAll()
            .where('id', '=', workspaceId)
            .executeTakeFirstOrThrow();

        const workspaceRow = PortalDB.Workspace.Row.parse(row);

        const plan = this.planRegistry.get(workspaceRow.plan_id);

        return PortalDB.Workspace.toDomain(workspaceRow, plan);
    }

    // Null covers both "no such workspace" and "not theirs to see": the row
    // policy filters it out, and telling those apart would leak membership.
    @AllowedDatabaseRoles('user')
    public async getForUser(trx: UserTrx, workspaceId: Workspace.Id): Promise<Workspace | null> {
        const row = await trx
            .selectFrom('workspaces')
            .selectAll()
            .where('id', '=', workspaceId)
            .executeTakeFirst();

        if (!row)
            return null;

        const workspaceRow = PortalDB.Workspace.Row.parse(row);

        const plan = this.planRegistry.get(workspaceRow.plan_id);

        return PortalDB.Workspace.toDomain(workspaceRow, plan);
    }

    @AllowedDatabaseRoles('service')
    public async getOwnerAndPlanIdForWorkspace(trx: ServiceTrx, workspaceId: Workspace.Id) {
        return trx
            .selectFrom('workspaces')
            .select(['owner_id', 'plan_id'])
            .where('id', '=', workspaceId)
            .executeTakeFirst();
    }

    @AllowedDatabaseRoles('service')
    public async setLifecycleState(trx: ServiceTrx, workspaceId: Workspace.Id, lifecycleState: Workspace.Lifecycle.State): Promise<Workspace> {
        const row = await trx
            .updateTable('workspaces')
            .set({ lifecycle_state: lifecycleState })
            .where('id', '=', workspaceId)
            .returningAll()
            .executeTakeFirstOrThrow();

        const workspaceRow = PortalDB.Workspace.Row.parse(row);

        const plan = this.planRegistry.get(workspaceRow.plan_id);

        return PortalDB.Workspace.toDomain(workspaceRow, plan);
    }

    @AllowedDatabaseRoles('service')
    public async setDisabled(trx: ServiceTrx, workspaceId: Workspace.Id, reason: string): Promise<void> {
        await trx
            .updateTable('workspaces')
            .set({ lifecycle_state: 'disabled', disabled_at: new Date(), disabled_reason: reason })
            .where('id', '=', workspaceId)
            .execute();
    }

    @AllowedDatabaseRoles('service')
    public async clearDisabled(trx: ServiceTrx, workspaceId: Workspace.Id): Promise<void> {
        await trx
            .updateTable('workspaces')
            .set({ lifecycle_state: 'sleeping', disabled_at: null, disabled_reason: null })
            .where('id', '=', workspaceId)
            .execute();
    }

    @AllowedDatabaseRoles('service')
    public async setAbandoned(trx: ServiceTrx, workspaceId: Workspace.Id): Promise<void> {
        await trx
            .updateTable('workspaces')
            .set({ abandoned_at: new Date() })
            .where('id', '=', workspaceId)
            .execute();
    }

    @AllowedDatabaseRoles('service')
    public async setPlan(trx: ServiceTrx, workspaceId: Workspace.Id, planId: Plan.Id): Promise<void> {
        await trx
            .updateTable('workspaces')
            .set({ plan_id: planId })
            .where('id', '=', workspaceId)
            .execute();
    }

    @AllowedDatabaseRoles('user')
    public async setDisplayName(trx: UserTrx, workspaceId: Workspace.Id, displayName: string): Promise<void> {
        await trx
            .updateTable('workspaces')
            .set({ display_name: displayName })
            .where('id', '=', workspaceId)
            .execute();
    }

    @AllowedDatabaseRoles('user')
    public async setSubdomain(trx: UserTrx, workspaceId: Workspace.Id, subdomain: Workspace.Subdomain | null): Promise<void> {
        await trx
            .updateTable('workspaces')
            .set({ subdomain })
            .where('id', '=', workspaceId)
            .execute();
    }

    @AllowedDatabaseRoles('user')
    public async delete(trx: UserTrx, workspaceId: Workspace.Id): Promise<void> {
        await trx
            .deleteFrom('workspaces')
            .where('id', '=', workspaceId)
            .execute();
    }
}
