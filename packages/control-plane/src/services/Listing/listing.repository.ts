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

    @Transactional('silo')
    public async insert(principal: Principal.Silo, request: Listing.API.Put.Request): Promise<Listing.Id> {
        const id = Listing.createId();

        await this.trx
            .insertInto('listings')
            .values({ id, ...toValues(principal.workspaceId, request) })
            .execute();

        return id;
    }

    // 0 rows updated means no such listing of this workspace.
    @Transactional('silo')
    public async update(principal: Principal.Silo, id: Listing.Id, request: Listing.API.Put.Request): Promise<number> {
        const result = await this.trx
            .updateTable('listings')
            .set(toValues(principal.workspaceId, request))
            .where('id', '=', id)
            .executeTakeFirst();

        return Number(result.numUpdatedRows);
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
    public async delete(principal: Principal.Silo, id: Listing.Id): Promise<number> {
        const result = await this.trx
            .deleteFrom('listings')
            .where('id', '=', id)
            .executeTakeFirst();

        return Number(result.numDeletedRows);
    }
}

const toValues = (workspaceId: Workspace.Id, request: Listing.API.Put.Request) => ({
    workspace_id:     workspaceId,
    publication_meta: request.publicationMeta,
    workflow_data:    request.workflowData,
});
