import { Injectable, NotFoundException } from '@nestjs/common';
import { Listing, Workspace } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';
import { Principal } from '@/auth/identity/principal';
import { ListingDatabase } from '@/services/Listing/listing.database';

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

    constructor(private readonly listingsDb: ListingDatabase) {}


    public async getAll(): Promise<Listing[]> {
        if (!process.env.EXTENDED_SHELF_WORKSPACE_ID)
            return [];

        return PortalDB.asService('read extended shelf listings', (trx) => this.listingsDb.getAllForWorkspace(trx, shelfWorkspace().workspaceId));
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
        const updated = await PortalDB.asSilo(shelfWorkspace(), (trx) => this.listingsDb.setBlueprintId(trx, id, blueprintId));

        if (updated === 0)
            throw new NotFoundException('No such listing');
    }
}
