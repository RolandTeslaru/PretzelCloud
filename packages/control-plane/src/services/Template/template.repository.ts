import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Listing, Template } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';
import { Repository, Transactional } from '@/db/repository';
import { Principal } from '@/auth/identity/principal';
import { selectResolvedListings } from '@/services/Listing/listing.resolve';

/** Row operations on `templates`: the listings an admin offers as templates. */
@Injectable()
export class TemplateRepository extends Repository(PortalDB) {

    // Every template this release can run, without the graphs.
    @Transactional('service')
    public async getAll(principal: Principal.Service, release: Listing.Release): Promise<Record<Listing.Id, Template>> {
        const rows = await selectResolvedListings(this.trx, release)
            .innerJoin('templates', 'templates.listing_id', 'listings.id')
            .leftJoin('extended_shelf', 'extended_shelf.listing_id', 'listings.id')
            .select([
                'listing_versions.listing_id',
                'listing_versions.version',
                'listing_versions.publication_id',
                'listing_versions.publication_meta',
                'listing_versions.release',
                'listing_versions.release_order',
                'listing_versions.published_at',
                'extended_shelf.blueprint_id',
                'templates.sort_order',
                'templates.category_ids',
                sql<string[]>`jsonb_path_query_array(listing_versions.workflow_data, '$.nodes.*.blueprintId')`.as('blueprint_ids'),
            ])
            .execute();

        const templates = rows.map((row) => Template.Schema.parse({
            ...PortalDB.toListingMeta(
                PortalDB.Listing.Row.parse({ ...row, id: row.listing_id }),
                PortalDB.ListingVersion.Row.omit({ workflow_data: true }).parse(row),
                row.blueprint_id,
            ),
            sortOrder:    row.sort_order,
            categoryIds:  row.category_ids,
            blueprintIds: [...new Set(row.blueprint_ids)],
        }));

        return Object.fromEntries(templates.map((template) => [template.id, template])) as Record<Listing.Id, Template>;
    }

    // Offers the listing as a template, or updates its place and categories; false when it is not listed.
    @Transactional('service')
    public async set(principal: Principal.Service, listingId: Listing.Id, request: Template.API.Set.Request): Promise<boolean> {
        const listing = await this.trx
            .selectFrom('listings')
            .select('id')
            .where('id', '=', listingId)
            .where('withdrawn_at', 'is', null)
            .executeTakeFirst();

        if (!listing)
            return false;

        const values = {
            sort_order:   request.sortOrder,
            category_ids: request.categoryIds,
        };

        await this.trx
            .insertInto('templates')
            .values({ listing_id: listingId, ...values })
            .onConflict((conflict) => conflict
                .column('listing_id')
                .doUpdateSet(values))
            .execute();

        return true;
    }

    // Idempotent: removing a listing that is not a template is a no-op.
    @Transactional('service')
    public async remove(principal: Principal.Service, listingId: Listing.Id): Promise<void> {
        await this.trx
            .deleteFrom('templates')
            .where('listing_id', '=', listingId)
            .execute();
    }
}
