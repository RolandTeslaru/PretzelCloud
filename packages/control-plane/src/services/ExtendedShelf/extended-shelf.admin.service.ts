import { Injectable, NotFoundException } from '@nestjs/common';
import { Listing } from '@pretzel-cloud/shared/domain';
import { Principal } from '@/auth/identity/principal';
import { ListingRepository } from '@/services/Listing/listing.repository';
import { shelfWorkspace } from './extended-shelf.service';

// Tagging runs as the pinned workspace, so RLS scopes it to that workspace's listings.
@Injectable()
export class ExtendedShelfAdminService {

    constructor(private readonly listingRepository: ListingRepository) {}

    public async add(adminUser: Principal.AdminUser, listingId: Listing.Id, blueprintId: string): Promise<void> {
        await this.setBlueprintId(listingId, blueprintId);
    }

    public async remove(adminUser: Principal.AdminUser, listingId: Listing.Id): Promise<void> {
        await this.setBlueprintId(listingId, null);
    }

    private async setBlueprintId(listingId: Listing.Id, blueprintId: string | null): Promise<void> {
        const updated = await this.listingRepository.setBlueprintId(shelfWorkspace(), listingId, blueprintId);

        if (updated === 0)
            throw new NotFoundException('No such listing');
    }
}
