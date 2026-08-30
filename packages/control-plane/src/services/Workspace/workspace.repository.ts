import { Injectable } from '@nestjs/common';
import { Plan, User, Workspace } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';
import { Repository, Transactional } from '@/db/repository';
import { Principal } from '@/auth/identity/principal';
import { PlanRegistry } from '@/services/Plan/plan.registry';

/** Row operations on `workspaces` and `workspace_members`. */
@Injectable()
export class WorkspaceRepository extends Repository(PortalDB) {

    constructor(private readonly planRegistry: PlanRegistry) {
        super();
    }

    /** Both rows or neither: no membership row means the owner cannot see it. */
    @Transactional('service')
    public async insert(principal: Principal.Service, values: {
        id:          Workspace.Id;
        displayName: string;
        ownerId:     User.Id;
    }): Promise<Workspace> {
        const row = await this.trx
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

        await this.trx
            .insertInto('workspace_members')
            .values({ workspace_id: values.id, user_id: values.ownerId })
            .execute();

        return this._toWorkspace(row);
    }

    @Transactional('service')
    public async get(principal: Principal.Service, workspaceId: Workspace.Id): Promise<Workspace> {
        const row = await this.trx
            .selectFrom('workspaces')
            .selectAll()
            .where('id', '=', workspaceId)
            .executeTakeFirstOrThrow();

        return this._toWorkspace(row);
    }

    // Null covers both "no such workspace" and "not theirs to see": the row
    // policy filters it out, and telling those apart would leak membership.
    @Transactional('user')
    public async getForUser(principal: Principal.User, workspaceId: Workspace.Id): Promise<Workspace | null> {
        const row = await this.trx
            .selectFrom('workspaces')
            .selectAll()
            .where('id', '=', workspaceId)
            .executeTakeFirst();

        return row ? this._toWorkspace(row) : null;
    }

    @Transactional('service')
    public async getOwnerAndPlanIdForWorkspace(principal: Principal.Service, workspaceId: Workspace.Id) {
        return this.trx
            .selectFrom('workspaces')
            .select(['owner_id', 'plan_id'])
            .where('id', '=', workspaceId)
            .executeTakeFirst();
    }

    @Transactional('service')
    public async setLifecycleState(principal: Principal.Service, workspaceId: Workspace.Id, lifecycleState: Workspace.Lifecycle.State): Promise<Workspace> {
        const row = await this.trx
            .updateTable('workspaces')
            .set({ lifecycle_state: lifecycleState })
            .where('id', '=', workspaceId)
            .returningAll()
            .executeTakeFirstOrThrow();

        return this._toWorkspace(row);
    }

    @Transactional('service')
    public async setDisabled(principal: Principal.Service, workspaceId: Workspace.Id, reason: string): Promise<void> {
        await this.trx
            .updateTable('workspaces')
            .set({ lifecycle_state: 'disabled', disabled_at: new Date(), disabled_reason: reason })
            .where('id', '=', workspaceId)
            .execute();
    }

    @Transactional('service')
    public async clearDisabled(principal: Principal.Service, workspaceId: Workspace.Id): Promise<void> {
        await this.trx
            .updateTable('workspaces')
            .set({ lifecycle_state: 'sleeping', disabled_at: null, disabled_reason: null })
            .where('id', '=', workspaceId)
            .execute();
    }

    @Transactional('service')
    public async setAbandoned(principal: Principal.Service, workspaceId: Workspace.Id): Promise<void> {
        await this.trx
            .updateTable('workspaces')
            .set({ abandoned_at: new Date() })
            .where('id', '=', workspaceId)
            .execute();
    }

    @Transactional('service')
    public async setPlan(principal: Principal.Service, workspaceId: Workspace.Id, planId: Plan.Id): Promise<void> {
        await this.trx
            .updateTable('workspaces')
            .set({ plan_id: planId })
            .where('id', '=', workspaceId)
            .execute();
    }

    @Transactional('user')
    public async setDisplayName(principal: Principal.User, workspaceId: Workspace.Id, displayName: string): Promise<void> {
        await this.trx
            .updateTable('workspaces')
            .set({ display_name: displayName })
            .where('id', '=', workspaceId)
            .execute();
    }

    @Transactional('user')
    public async setSubdomain(principal: Principal.User, workspaceId: Workspace.Id, subdomain: Workspace.Subdomain | null): Promise<void> {
        await this.trx
            .updateTable('workspaces')
            .set({ subdomain })
            .where('id', '=', workspaceId)
            .execute();
    }

    @Transactional('user')
    public async delete(principal: Principal.User, workspaceId: Workspace.Id): Promise<void> {
        await this.trx
            .deleteFrom('workspaces')
            .where('id', '=', workspaceId)
            .execute();
    }

    private _toWorkspace(row: unknown): Workspace {
        const workspaceRow = PortalDB.Workspace.Row.parse(row);

        const plan = this.planRegistry.get(workspaceRow.plan_id);

        return PortalDB.Workspace.toDomain(workspaceRow, plan);
    }
}
