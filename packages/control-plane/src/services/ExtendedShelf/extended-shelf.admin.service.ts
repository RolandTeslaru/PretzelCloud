import { Injectable, NotFoundException } from '@nestjs/common';
import { Listing } from '@pretzel-cloud/shared/domain';
import { Principal } from '@/auth/identity/principal';
import { ExtendedShelfRepository } from './extended-shelf.repository';
import { shelfWorkspace } from './extended-shelf.service';

// Tags the pinned workspace's listings with the blueprint ids they appear under.
@Injectable()
export class ExtendedShelfAdminService {

    constructor(private readonly extendedShelfRepository: ExtendedShelfRepository) {}

    public async add(adminUser: Principal.AdminUser, listingId: Listing.Id, blueprintId: string): Promise<void> {
        await this.setBlueprintId(listingId, blueprintId);
    }

    public async remove(adminUser: Principal.AdminUser, listingId: Listing.Id): Promise<void> {
        await this.setBlueprintId(listingId, null);
    }

    private async setBlueprintId(listingId: Listing.Id, blueprintId: string | null): Promise<void> {
        const found = await this.extendedShelfRepository.setBlueprintId(Principal.SELF, shelfWorkspace().workspaceId, listingId, blueprintId);

        if (!found)
            throw new NotFoundException('No such listing');
    }
}
