import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Listing, Workspace } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';
import { Repository, Transactional } from '@/db/repository';
import { Principal } from '@/auth/identity/principal';

// A release as the integer array `listing_versions.release_order` stores.
const releaseOrder = (release: Listing.Release) =>
    sql<number[]>`string_to_array(split_part(${release}, '+', 1), '.')::integer[]`;

type ResolveFilter = {
    ids?:          Listing.Id[]
    workspaceId?:  Workspace.Id
    blueprintIds?: readonly string[]
};

/** Row operations on `listings` and `listing_versions`. */
@Injectable()
export class ListingRepository extends Repository(PortalDB) {


    @Transactional('service')
    public async find(principal: Principal.Service, id: Listing.Id, release: Listing.Release): Promise<Listing | null> {
        const [listing] = await this._resolve(release, { ids: [id] });

        return listing ?? null;
    }


    @Transactional('service')
    public async getUpdates(principal: Principal.Service, ids: Listing.Id[], release: Listing.Release): Promise<Record<Listing.Id, Listing.Data>> {
        if (ids.length === 0)
            return {};

        const listings = await this._resolve(release, { ids });

        return Object.fromEntries(listings.map((listing) => [listing.id, listing.publicationMeta]));
    }

    @Transactional('service')
    public async getAllForWorkspace(principal: Principal.Service, workspaceId: Workspace.Id, release: Listing.Release): Promise<Listing[]> {
        return this._resolve(release, { workspaceId });
    }

    @Transactional('service')
    public async getByBlueprintIds(principal: Principal.Service, blueprintIds: readonly string[], release: Listing.Release): Promise<Listing[]> {
        if (blueprintIds.length === 0)
            return [];

        return this._resolve(release, { blueprintIds });
    }

    // The calling workspace's listed workflows, keyed by its workflow ids.
    @Transactional('silo')
    public async getOwnedIds(principal: Principal.Silo): Promise<Record<Listing.WorkflowId, Listing.Id>> {
        const rows = await this.trx
            .selectFrom('listings')
            .select(['id', 'workflow_id'])
            .where('workspace_id', '=', principal.workspaceId)
            .where('withdrawn_at', 'is', null)
            .execute();

        return Object.fromEntries(rows.map((row) => [row.workflow_id, row.id]));
    }

    // Lists the workflow, or lists it again under the same id, then writes the version.
    @Transactional('silo')
    public async share(principal: Principal.Silo, workflowId: Listing.WorkflowId, request: Listing.API.Put.Request): Promise<Listing.Id> {
        const { id } = await this.trx
            .insertInto('listings')
            .values({
                id:           Listing.createId(),
                workspace_id: principal.workspaceId,
                workflow_id:  workflowId,
            })
            .onConflict((conflict) => conflict
                .columns(['workspace_id', 'workflow_id'])
                .doUpdateSet({ withdrawn_at: null }))
            .returning('id')
            .executeTakeFirstOrThrow();

        await this._writeVersion(id, request);

        return id;
    }

    // null means this workflow is not listed.
    @Transactional('silo')
    public async writeVersion(principal: Principal.Silo, workflowId: Listing.WorkflowId, request: Listing.API.Put.Request): Promise<Listing.Id | null> {
        const listing = await this.trx
            .selectFrom('listings')
            .select('id')
            .where('workspace_id', '=', principal.workspaceId)
            .where('workflow_id', '=', workflowId)
            .where('withdrawn_at', 'is', null)
            .executeTakeFirst();

        if (!listing)
            return null;

        await this._writeVersion(listing.id, request);

        return listing.id;
    }

    // Teardown path: the fleet acting, not the silo, so the service role.
    @Transactional('service')
    public async deleteAllForWorkspace(principal: Principal.Service, workspaceId: Workspace.Id): Promise<void> {
        await this.trx
            .deleteFrom('listings')
            .where('workspace_id', '=', workspaceId)
            .execute();
    }

    // Hides the listing from every read and keeps its versions; 0 means it was not listed.
    @Transactional('silo')
    public async withdraw(principal: Principal.Silo, workflowId: Listing.WorkflowId): Promise<number> {
        const result = await this.trx
            .updateTable('listings')
            .set({ withdrawn_at: new Date() })
            .where('workspace_id', '=', principal.workspaceId)
            .where('workflow_id', '=', workflowId)
            .where('withdrawn_at', 'is', null)
            .executeTakeFirst();

        return Number(result.numUpdatedRows);
    }


    // Replaces every version at or above the release with the new one; the listing row is locked
    // so concurrent writes number their versions in turn.
    private async _writeVersion(listingId: Listing.Id, request: Listing.API.Put.Request): Promise<void> {
        const { release } = request;

        await this.trx
            .selectFrom('listings')
            .select('id')
            .where('id', '=', listingId)
            .forUpdate()
            .executeTakeFirstOrThrow();

        const { latest } = await this.trx
            .selectFrom('listing_versions')
            .select((eb) => eb.fn.max('version').as('latest'))
            .where('listing_id', '=', listingId)
            .executeTakeFirstOrThrow();

        await this.trx
            .deleteFrom('listing_versions')
            .where('listing_id', '=', listingId)
            .where(sql<boolean>`release_order >= ${releaseOrder(release)}`)
            .execute();

        await this.trx
            .insertInto('listing_versions')
            .values({
                listing_id:       listingId,
                version:          (latest ?? 0) + 1,
                publication_id:   String(request.publicationMeta.id),
                publication_meta: request.publicationMeta,
                workflow_data:    request.workflowData,
                release,
            })
            .execute();
    }

    // Each matching listed workflow with the version the release resolves to: the highest release at or below it.
    private async _resolve(release: Listing.Release, filter: ResolveFilter): Promise<Listing[]> {
        let query = this.trx
            .selectFrom('listings')
            .innerJoin('listing_versions', 'listing_versions.listing_id', 'listings.id')
            .leftJoin('extended_shelf', 'extended_shelf.listing_id', 'listings.id')
            .selectAll('listing_versions')
            .select(['listings.workspace_id', 'listings.workflow_id', 'listings.created_at', 'listings.withdrawn_at', 'extended_shelf.blueprint_id'])
            .distinctOn('listing_versions.listing_id')
            .where('listings.withdrawn_at', 'is', null)
            .where(sql<boolean>`listing_versions.release_order <= ${releaseOrder(release)}`)
            .orderBy('listing_versions.listing_id')
            .orderBy('listing_versions.release_order', 'desc');

        if (filter.ids)
            query = query.where('listings.id', 'in', filter.ids);

        if (filter.workspaceId)
            query = query.where('listings.workspace_id', '=', filter.workspaceId);

        if (filter.blueprintIds)
            query = query.where('extended_shelf.blueprint_id', 'in', [...filter.blueprintIds]);

        const rows = await query.execute();

        return rows.map((row) => PortalDB.toListing(
            PortalDB.Listing.Row.parse({ ...row, id: row.listing_id }),
            PortalDB.ListingVersion.Row.parse(row),
            row.blueprint_id,
        ));
    }
}
