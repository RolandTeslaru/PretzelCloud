import { Body, Controller, Delete, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { ExtendedShelf, Listing } from '@pretzel-cloud/shared/domain';
import { UserAuthGuard } from '@/auth/guards/user-auth.guard';
import { AdminGuard } from '@/auth/guards/admin.guard';
import { AuthenticatedAdminUser } from '@/auth/identity/principal.decorator';
import { Principal } from '@/auth/identity/principal';
import { ExtendedShelfService } from './extended-shelf.service';
import { ExtendedShelfAdminService } from './extended-shelf.admin.service';

// The extended shelf: an open read for every workspace, admin-only tagging.
@Controller()
export class ExtendedShelfController {

    constructor(
        private readonly extendedShelfService:      ExtendedShelfService,
        private readonly extendedShelfAdminService: ExtendedShelfAdminService,
    ) {}


    @Get('extended-shelf')
    public async getAll(@Query() query: unknown): Promise<ExtendedShelf.API.List.Response> {
        const { release } = Listing.API.ReleaseQuery.parse(query);

        return { workflows: await this.extendedShelfService.getAll(release) };
    }

    @Put('admin/extended-shelf/:id')
    @UseGuards(UserAuthGuard, AdminGuard)
    public async add(
        @AuthenticatedAdminUser() adminUser: Principal.AdminUser,
        @Param('id') listingId: string,
        @Body() body: unknown,
    ): Promise<Record<string, never>> {
        const { blueprintId } = ExtendedShelf.API.Add.Request.parse(body);

        await this.extendedShelfAdminService.add(adminUser, Listing.Id.parse(listingId), blueprintId);

        return {};
    }

    @Delete('admin/extended-shelf/:id')
    @UseGuards(UserAuthGuard, AdminGuard)
    public async remove(
        @AuthenticatedAdminUser() adminUser: Principal.AdminUser,
        @Param('id') listingId: string,
    ): Promise<Record<string, never>> {
        await this.extendedShelfAdminService.remove(adminUser, Listing.Id.parse(listingId));

        return {};
    }
}
