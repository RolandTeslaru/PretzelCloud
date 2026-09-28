import { Injectable } from '@nestjs/common';
import { Admin } from '@pretzel-cloud/shared/domain';
import { Principal } from '@/auth/identity/principal';
import { ListingAdminRepository } from './listing.admin.repository';

/** Listing reads only an admin reaches, across every workspace. */
@Injectable()
export class ListingAdminService {

    constructor(private readonly listingAdminRepository: ListingAdminRepository) {}

    public async list(adminUser: Principal.AdminUser): Promise<Admin.ListingSummary[]> {
        return this.listingAdminRepository.list(Principal.SELF);
    }
}
