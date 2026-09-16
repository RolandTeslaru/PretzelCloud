import { Injectable } from '@nestjs/common';
import { User, Workspace } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';
import { Repository, Transactional } from '@/db/repository';
import { Principal } from '@/auth/identity/principal';
import { PlanRegistry } from '@/services/Plan/plan.registry';

/** Row operations on `workspaces` that reach every owner's. */
@Injectable()
export class WorkspaceAdminRepository extends Repository(PortalDB) {

    constructor(private readonly planRegistry: PlanRegistry) {
        super();
    }

    @Transactional('service')
    public async list(principal: Principal.Service): Promise<Workspace[]> {
        const rows = await this.trx
            .selectFrom('workspaces')
            .selectAll()
            .orderBy('created_at', 'desc')
            .execute();

        return rows.map((row) => this._toWorkspace(row));
    }

    @Transactional('service')
    public async getMemberIds(principal: Principal.Service, workspaceId: Workspace.Id): Promise<User.Id[]> {
        const rows = await this.trx
            .selectFrom('workspace_members')
            .select('user_id')
            .where('workspace_id', '=', workspaceId)
            .execute();

        return rows.map((row) => row.user_id);
    }

    private _toWorkspace(row: unknown): Workspace {
        const workspaceRow = PortalDB.Workspace.Row.parse(row);

        const plan = this.planRegistry.get(workspaceRow.plan_id);

        return PortalDB.Workspace.toDomain(workspaceRow, plan);
    }
}
