import { Injectable } from '@nestjs/common';
import { Listing, Workspace } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';
import { Repository, Transactional } from '@/db/repository';
import { Principal } from '@/auth/identity/principal';

/** Row operations on `listings`. */
@Injectable()
export class ListingRepository extends Repository(PortalDB) {


    @Transactional('service')
    public async find(principal: Principal.Service, id: Listing.Id): Promise<Listing | null> {
        const row = await this.trx
            .selectFrom('listings')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();

        return row ? PortalDB.Listing.toDomain(PortalDB.Listing.Row.parse(row)) : null;
    }


    @Transactional('service')
    public async getUpdates(principal: Principal.Service, ids: Listing.Id[]): Promise<Record<Listing.Id, Listing.Data>> {
        const rows = await this.trx
            .selectFrom('listings')
            .select(['id', 'publication_meta'])
            .where('id', 'in', ids)
            .execute();

        return Object.fromEntries(rows.map((row) => [row.id, row.publication_meta]));
    }

    @Transactional('service')
    public async getAllForWorkspace(principal: Principal.Service, workspaceId: Workspace.Id): Promise<Listing[]> {
        const rows = await this.trx
            .selectFrom('listings')
            .selectAll()
            .where('workspace_id', '=', workspaceId)
            .execute();

        return rows.map((row) => PortalDB.Listing.toDomain(PortalDB.Listing.Row.parse(row)));
    }

    // The calling workspace's listing ids, keyed by its workflow ids.
    @Transactional('silo')
    public async getOwnedIds(principal: Principal.Silo): Promise<Record<Listing.WorkflowId, Listing.Id>> {
        const rows = await this.trx
            .selectFrom('listings')
            .select(['id', 'workflow_id'])
            .where('workspace_id', '=', principal.workspaceId)
            .execute();

        return Object.fromEntries(rows.map((row) => [row.workflow_id, row.id]));
    }

    // 0 rows updated means no such listing of this workspace.
    @Transactional('silo')
    public async setBlueprintId(principal: Principal.Silo, id: Listing.Id, blueprintId: string | null): Promise<number> {
        const result = await this.trx
            .updateTable('listings')
            .set({ blueprint_id: blueprintId })
            .where('id', '=', id)
            .executeTakeFirst();

        return Number(result.numUpdatedRows);
    }

    // Mints on first push; later pushes for the same workflow replace the copy.
    @Transactional('silo')
    public async upsert(principal: Principal.Silo, workflowId: Listing.WorkflowId, request: Listing.API.Put.Request): Promise<Listing.Id> {
        const values = toValues(request);

        const row = await this.trx
            .insertInto('listings')
            .values({
                id:           Listing.createId(),
                workspace_id: principal.workspaceId,
                workflow_id:  workflowId,
                ...values,
            })
            .onConflict((conflict) => conflict
                .columns(['workspace_id', 'workflow_id'])
                .doUpdateSet(values))
            .returning('id')
            .executeTakeFirstOrThrow();

        return row.id;
    }

    // 0 rows updated means this workflow is not listed.
    @Transactional('silo')
    public async update(principal: Principal.Silo, workflowId: Listing.WorkflowId, request: Listing.API.Put.Request): Promise<Listing.Id | null> {
        const row = await this.trx
            .updateTable('listings')
            .set(toValues(request))
            .where('workspace_id', '=', principal.workspaceId)
            .where('workflow_id', '=', workflowId)
            .returning('id')
            .executeTakeFirst();

        return row?.id ?? null;
    }

    // Teardown path: the fleet acting, not the silo, so the service role.
    @Transactional('service')
    public async deleteAllForWorkspace(principal: Principal.Service, workspaceId: Workspace.Id): Promise<void> {
        await this.trx
            .deleteFrom('listings')
            .where('workspace_id', '=', workspaceId)
            .execute();
    }

    @Transactional('silo')
    public async deleteByWorkflow(principal: Principal.Silo, workflowId: Listing.WorkflowId): Promise<number> {
        const result = await this.trx
            .deleteFrom('listings')
            .where('workspace_id', '=', principal.workspaceId)
            .where('workflow_id', '=', workflowId)
            .executeTakeFirst();

        return Number(result.numDeletedRows);
    }
}

const toValues = (request: Listing.API.Put.Request) => ({
    publication_meta: request.publicationMeta,
    workflow_data:    request.workflowData,
});
