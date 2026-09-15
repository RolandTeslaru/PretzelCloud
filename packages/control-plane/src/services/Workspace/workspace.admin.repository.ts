import { Injectable } from '@nestjs/common';
import { Workspace } from '@pretzel-cloud/shared/domain';
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
    public async delete(principal: Principal.Service, workspaceId: Workspace.Id): Promise<void> {
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
