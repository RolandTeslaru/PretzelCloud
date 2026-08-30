import { Injectable, NotFoundException } from '@nestjs/common';
import { Listing, Workspace } from '@pretzel-cloud/shared/domain';
import { Principal } from '@/auth/identity/principal';
import { ListingRepository } from '@/services/Listing/listing.repository';

// The one workspace whose listings form the extended shelf. Unset means none.
const shelfWorkspace = (): Principal.Silo => {
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

    // Tagging runs as the pinned workspace, so RLS scopes it to that workspace's listings.
    public readonly operator = {
        add: async (id: Listing.Id, blueprintId: string): Promise<void> => {
            await this.setBlueprintId(id, blueprintId);
        },

        remove: async (id: Listing.Id): Promise<void> => {
            await this.setBlueprintId(id, null);
        },
    };

    private async setBlueprintId(id: Listing.Id, blueprintId: string | null): Promise<void> {
        const updated = await this.listingRepository.setBlueprintId(shelfWorkspace(), id, blueprintId);

        if (updated === 0)
            throw new NotFoundException('No such listing');
    }
}
