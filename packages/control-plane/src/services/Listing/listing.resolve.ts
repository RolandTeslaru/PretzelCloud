import { Kysely, sql } from 'kysely';
import { Listing } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';

// A release as the integer array `listing_versions.release_order` stores.
export const releaseOrder = (release: Listing.Release) =>
    sql<number[]>`string_to_array(split_part(${release}, '+', 1), '.')::integer[]`;

// Each listed workflow joined with the version the release resolves to: the highest release at or below it.
export const selectResolvedListings = (trx: Kysely<PortalDB.Tables>, release: Listing.Release) =>
    trx
        .selectFrom('listings')
        .innerJoin('listing_versions', 'listing_versions.listing_id', 'listings.id')
        .select(['listings.workspace_id', 'listings.workflow_id', 'listings.created_at', 'listings.withdrawn_at'])
        .distinctOn('listing_versions.listing_id')
        .where('listings.withdrawn_at', 'is', null)
        .where(sql<boolean>`listing_versions.release_order <= ${releaseOrder(release)}`)
        .orderBy('listing_versions.listing_id')
        .orderBy('listing_versions.release_order', 'desc');
