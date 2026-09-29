import { Controller, Delete, Get, HttpCode, Put, Query, UseGuards } from '@nestjs/common';
import { Listing, Template } from '@pretzel-cloud/shared/domain';
import { UserAuthGuard } from '@/auth/guards/user-auth.guard';
import { AdminGuard } from '@/auth/guards/admin.guard';
import { AuthenticatedAdminUser } from '@/auth/identity/principal.decorator';
import { Principal } from '@/auth/identity/principal';
import { ZodBody, ZodParam } from '@pretzel-cloud/shared/server/pipes/zod.pipe';
import { TemplateService } from './template.service';
import { TemplateAdminService } from './template.admin.service';

// Templates: an open read for every workspace, admin-only picking.
@Controller()
export class TemplateController {

    constructor(
        private readonly templateService:      TemplateService,
        private readonly templateAdminService: TemplateAdminService,
    ) {}


    @Get('templates')
    public async getAll(@Query() query: unknown): Promise<Template.API.List.Response> {
        const { release } = Listing.API.ReleaseQuery.parse(query);

        return { templates: await this.templateService.getAll(release) };
    }

    @Put('admin/templates/:id')
    @UseGuards(UserAuthGuard, AdminGuard)
    public async set(
        @AuthenticatedAdminUser()          adminUser: Principal.AdminUser,
        @ZodParam('id', Listing.Id)        listingId: Listing.Id,
        @ZodBody(Template.API.Set.Request) body:      Template.API.Set.Request,
    ): Promise<Record<string, never>> {
        await this.templateAdminService.set(adminUser, listingId, body);

        return {};
    }

    @Delete('admin/templates/:id')
    @HttpCode(204)
    @UseGuards(UserAuthGuard, AdminGuard)
    public async remove(
        @AuthenticatedAdminUser()   adminUser: Principal.AdminUser,
        @ZodParam('id', Listing.Id) listingId: Listing.Id,
    ): Promise<void> {
        await this.templateAdminService.remove(adminUser, listingId);
    }
}
