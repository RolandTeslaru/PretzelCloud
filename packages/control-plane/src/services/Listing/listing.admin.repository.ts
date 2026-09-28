import { Injectable } from '@nestjs/common';
import { Admin } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';
import { Repository, Transactional } from '@/db/repository';
import { Principal } from '@/auth/identity/principal';

/** Row operations on `listings` that reach every workspace's listings. */
@Injectable()
export class ListingAdminRepository extends Repository(PortalDB) {

    // Every listed workflow at its latest version, newest listing first.
    @Transactional('service')
    public async list(principal: Principal.Service): Promise<Admin.ListingSummary[]> {
        const rows = await this.trx
            .selectFrom('listings')
            .innerJoin('listing_versions', 'listing_versions.listing_id', 'listings.id')
            .innerJoin('workspaces', 'workspaces.id', 'listings.workspace_id')
            .leftJoin('extended_shelf', 'extended_shelf.listing_id', 'listings.id')
            .leftJoin('templates', 'templates.listing_id', 'listings.id')
            .select([
                'listings.id',
                'listings.workspace_id',
                'listings.workflow_id',
                'listings.created_at',
                'workspaces.display_name as workspace_display_name',
                'listing_versions.version',
                'listing_versions.release',
                'listing_versions.published_at',
                'listing_versions.publication_meta',
                'extended_shelf.blueprint_id',
                'templates.listing_id as template_listing_id',
                'templates.sort_order',
                'templates.category_ids',
            ])
            .distinctOn('listings.id')
            .where('listings.withdrawn_at', 'is', null)
            .orderBy('listings.id')
            .orderBy('listing_versions.version', 'desc')
            .execute();

        const listings = rows.map((row) => {
            const workflowMeta = (row.publication_meta.workflow_meta ?? {}) as Record<string, unknown>;

            return Admin.ListingSummary.parse({
                id:          row.id,
                workspace:   { id: row.workspace_id, displayName: row.workspace_display_name },
                workflowId:  row.workflow_id,
                name:        workflowMeta.display_name ?? 'Untitled workflow',
                description: workflowMeta.description ?? null,
                version:     row.version,
                release:     row.release,
                publishedAt: row.published_at,
                createdAt:   row.created_at,
                blueprintId: row.blueprint_id,
                template:    row.template_listing_id === null ? null : { sortOrder: row.sort_order, categoryIds: row.category_ids },
            });
        });

        return listings.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }
}
