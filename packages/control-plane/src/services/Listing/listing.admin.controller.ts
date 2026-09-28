import { Controller, Get, UseGuards } from '@nestjs/common';
import { Admin } from '@pretzel-cloud/shared/domain';
import { UserAuthGuard } from '@/auth/guards/user-auth.guard';
import { AdminGuard } from '@/auth/guards/admin.guard';
import { AuthenticatedAdminUser } from '@/auth/identity/principal.decorator';
import { Principal } from '@/auth/identity/principal';
import { ListingAdminService } from './listing.admin.service';

@Controller('admin/listings')
@UseGuards(UserAuthGuard, AdminGuard)
export class ListingAdminController {
    constructor(private readonly listingAdminService: ListingAdminService) {}

    @Get()
    public async list(
        @AuthenticatedAdminUser() adminUser: Principal.AdminUser,
    ): Promise<Admin.API.Listings.List.Response> {
        return { listings: await this.listingAdminService.list(adminUser) };
    }
}
