import { Injectable, NotFoundException } from '@nestjs/common';
import { Listing, Workspace } from '@pretzel-cloud/shared/domain';
import { Principal } from '@/auth/identity/principal';
import { ListingRepository } from '@/services/Listing/listing.repository';

// The one workspace whose listings form the extended shelf. Unset means none.
export const shelfWorkspace = (): Principal.Silo => {
    const workspaceId = process.env.EXTENDED_SHELF_WORKSPACE_ID;

    if (!workspaceId)
        throw new NotFoundException();

    return { type: 'silo', workspaceId: Workspace.Id.parse(workspaceId) };
};

// Blueprints every workspace ships beyond its own, backed by ordinary listings.
@Injectable()
export class ExtendedShelfService {

    constructor(private readonly listingRepository: ListingRepository) {}


    public async getAll(): Promise<Listing[]> {
        if (!process.env.EXTENDED_SHELF_WORKSPACE_ID)
            return [];

        return this.listingRepository.getAllForWorkspace(Principal.SELF, shelfWorkspace().workspaceId);
    }
}
