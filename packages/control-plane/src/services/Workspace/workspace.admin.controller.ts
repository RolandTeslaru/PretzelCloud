import { Controller, Delete, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Admin, Workspace } from '@pretzel-cloud/shared/domain';
import { UserAuthGuard } from '@/auth/guards/user-auth.guard';
import { AdminGuard } from '@/auth/guards/admin.guard';
import { ZodBody, ZodParam } from '@pretzel-cloud/shared/server/pipes/zod.pipe';
import { AuthenticatedAdminUser } from '@/auth/identity/principal.decorator';
import { Principal } from '@/auth/identity/principal';
import { WorkspaceAdminService } from './workspace.admin.service';

@Controller('admin/workspaces')
@UseGuards(UserAuthGuard, AdminGuard)
export class WorkspaceAdminController {
    constructor(private readonly workspaceAdminService: WorkspaceAdminService) {}

    @Get()
    public async list(
        @AuthenticatedAdminUser() adminUser: Principal.AdminUser,
    ): Promise<Admin.API.List.Response> {
        return { workspaces: await this.workspaceAdminService.list(adminUser) };
    }

    @Delete(':workspaceId')
    @HttpCode(204)
    public async destroy(
        @AuthenticatedAdminUser() adminUser: Principal.AdminUser,
        @ZodParam('workspaceId', Workspace.Id) workspaceId: Workspace.Id,
        @ZodBody(Admin.API.Destroy.Request) body: Admin.API.Destroy.Request,
    ): Promise<void> {
        await this.workspaceAdminService.destroy(adminUser, workspaceId, body.confirmation);
    }

    @Post(':workspaceId/disable')
    public async disable(
        @AuthenticatedAdminUser() adminUser: Principal.AdminUser,
        @ZodParam('workspaceId', Workspace.Id) workspaceId: Workspace.Id,
        @ZodBody(Admin.API.Disable.Request) body: Admin.API.Disable.Request,
    ): Promise<Record<string, never>> {
        await this.workspaceAdminService.disable(adminUser, workspaceId, body.reason || 'This workspace has been disabled by an admin.');

        return {};
    }

    @Post(':workspaceId/enable')
    public async enable(
        @AuthenticatedAdminUser() adminUser: Principal.AdminUser,
        @ZodParam('workspaceId', Workspace.Id) workspaceId: Workspace.Id,
    ): Promise<Record<string, never>> {
        await this.workspaceAdminService.enable(adminUser, workspaceId);

        return {};
    }
}
