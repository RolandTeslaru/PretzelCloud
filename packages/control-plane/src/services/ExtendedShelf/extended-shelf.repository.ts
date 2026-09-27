import { Injectable } from '@nestjs/common';
import { Listing, Workspace } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';
import { Repository, Transactional } from '@/db/repository';
import { Principal } from '@/auth/identity/principal';

/** Row operations on `extended_shelf`: the operator's blueprint ids for listings. */
@Injectable()
export class ExtendedShelfRepository extends Repository(PortalDB) {

    // Only a listing of the shelf workspace can be tagged; false when it is not one.
    @Transactional('service')
    public async setBlueprintId(principal: Principal.Service, shelfWorkspaceId: Workspace.Id, listingId: Listing.Id, blueprintId: string | null): Promise<boolean> {
        const listing = await this.trx
            .selectFrom('listings')
            .select('id')
            .where('id', '=', listingId)
            .where('workspace_id', '=', shelfWorkspaceId)
            .executeTakeFirst();

        if (!listing)
            return false;

        if (blueprintId === null) {
            await this.trx
                .deleteFrom('extended_shelf')
                .where('listing_id', '=', listingId)
                .execute();

            return true;
        }

        await this.trx
            .insertInto('extended_shelf')
            .values({ listing_id: listingId, blueprint_id: blueprintId })
            .onConflict((conflict) => conflict
                .column('listing_id')
                .doUpdateSet({ blueprint_id: blueprintId }))
            .execute();

        return true;
    }
}
