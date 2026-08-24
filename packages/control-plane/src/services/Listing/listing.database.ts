import { Injectable } from '@nestjs/common';
import { Listing, Workspace } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';
import { AllowedDatabaseRoles, DatabaseClass } from '@/decorators/database';

type ServiceTrx   = PortalDB.ServiceTransaction;
type SiloTrx      = PortalDB.SiloTransaction;


@Injectable()
@DatabaseClass
export class ListingDatabase {


    @AllowedDatabaseRoles('service')
    public async find(trx: ServiceTrx, id: Listing.Id): Promise<Listing | null> {
        const row = await trx
            .selectFrom('listings')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();

        return row ? PortalDB.Listing.toDomain(PortalDB.Listing.Row.parse(row)) : null;
    }


    @AllowedDatabaseRoles('service')
    public async getUpdates(trx: ServiceTrx, ids: Listing.Id[]): Promise<Record<Listing.Id, Listing.Data>> {
        const rows = await trx
            .selectFrom('listings')
            .select(['id', 'publication_meta'])
            .where('id', 'in', ids)
            .execute();

        return Object.fromEntries(rows.map((row) => [row.id, row.publication_meta]));
    }

    @AllowedDatabaseRoles('service')
    public async getAllForWorkspace(trx: ServiceTrx, workspaceId: Workspace.Id): Promise<Listing[]> {
        const rows = await trx
            .selectFrom('listings')
            .selectAll()
            .where('workspace_id', '=', workspaceId)
            .execute();

        return rows.map((row) => PortalDB.Listing.toDomain(PortalDB.Listing.Row.parse(row)));
    }

    // 0 rows updated means no such listing of this workspace.
    @AllowedDatabaseRoles('silo')
    public async setBlueprintId(trx: SiloTrx, id: Listing.Id, blueprintId: string | null): Promise<number> {
        const result = await trx
            .updateTable('listings')
            .set({ blueprint_id: blueprintId })
            .where('id', '=', id)
            .executeTakeFirst();

        return Number(result.numUpdatedRows);
    }

    @AllowedDatabaseRoles('silo')
    public async insert(trx: SiloTrx, workspaceId: Workspace.Id, request: Listing.API.Put.Request): Promise<Listing.Id> {
        const id = Listing.createId();

        await trx
            .insertInto('listings')
            .values({ id, ...toValues(workspaceId, request) })
            .execute();

        return id;
    }

    // 0 rows updated means no such listing of this workspace.
    @AllowedDatabaseRoles('silo')
    public async update(trx: SiloTrx, id: Listing.Id, workspaceId: Workspace.Id, request: Listing.API.Put.Request): Promise<number> {
        const result = await trx
            .updateTable('listings')
            .set(toValues(workspaceId, request))
            .where('id', '=', id)
            .executeTakeFirst();

        return Number(result.numUpdatedRows);
    }

    // Teardown path: the fleet acting, not the silo, so the service role.
    @AllowedDatabaseRoles('service')
    public async deleteAllForWorkspace(trx: ServiceTrx, workspaceId: Workspace.Id): Promise<void> {
        await trx
            .deleteFrom('listings')
            .where('workspace_id', '=', workspaceId)
            .execute();
    }

    @AllowedDatabaseRoles('silo')
    public async delete(trx: SiloTrx, id: Listing.Id): Promise<number> {
        const result = await trx
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
