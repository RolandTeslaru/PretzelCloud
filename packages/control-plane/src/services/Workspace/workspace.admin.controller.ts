import { Controller, Delete, Get, HttpCode, Logger, Post, Query, UseGuards } from '@nestjs/common';
import { Admin, Workspace } from '@pretzel-cloud/shared/domain';
import { UserAuthGuard } from '@/auth/guards/user-auth.guard';
import { AdminGuard } from '@/auth/guards/admin.guard';
import { ZodBody, ZodParam } from '@pretzel-cloud/shared/server/pipes/zod.pipe';
import { AuthenticatedAdminUser } from '@/auth/identity/principal.decorator';
import { Principal } from '@/auth/identity/principal';
import { RefuseIfBusy } from '@/decorators/operation';
import { LockService } from '@/services/Locking/lock.service';
import { WorkspaceAdminService } from './workspace.admin.service';

@Controller('admin/workspaces')
@UseGuards(UserAuthGuard, AdminGuard)
export class WorkspaceAdminController {
    private readonly logger = new Logger(WorkspaceAdminController.name);

    constructor(
        private readonly workspaceAdminService: WorkspaceAdminService,
        public readonly lockService: LockService,
    ) {}

    @Get()
    public async list(
        @AuthenticatedAdminUser() adminUser: Principal.AdminUser,
    ): Promise<Admin.API.List.Response> {
        return { workspaces: await this.workspaceAdminService.list(adminUser) };
    }

    @Get(':workspaceId')
    public async get(
        @AuthenticatedAdminUser() adminUser: Principal.AdminUser,
        @ZodParam('workspaceId', Workspace.Id) workspaceId: Workspace.Id,
    ): Promise<Admin.API.Get.Response> {
        return this.workspaceAdminService.get(adminUser, workspaceId);
    }

    @Get(':workspaceId/executions')
    public async listUsage(
        @AuthenticatedAdminUser() adminUser: Principal.AdminUser,
        @ZodParam('workspaceId', Workspace.Id) workspaceId: Workspace.Id,
        @Query('window') window?: string,
    ): Promise<Workspace.API.ListUsage.Response> {
        return { records: await this.workspaceAdminService.listUsage(adminUser, workspaceId, Workspace.Usage.Window.catch('week').parse(window)) };
    }

    @Get(':workspaceId/executions/series')
    public async getUsageSeries(
        @AuthenticatedAdminUser() adminUser: Principal.AdminUser,
        @ZodParam('workspaceId', Workspace.Id) workspaceId: Workspace.Id,
    ): Promise<Workspace.API.GetUsageSeries.Response> {
        return { points: await this.workspaceAdminService.getUsageSeries(adminUser, workspaceId) };
    }

    @Get(':workspaceId/executions/report')
    public async getUsageReport(
        @AuthenticatedAdminUser() adminUser: Principal.AdminUser,
        @ZodParam('workspaceId', Workspace.Id) workspaceId: Workspace.Id,
    ): Promise<Workspace.API.GetUsageReport.Response> {
        return this.workspaceAdminService.getUsageReport(adminUser, workspaceId);
    }

    @Post(':workspaceId/lifecycle/:action')
    @RefuseIfBusy('workspace', 1)
    @HttpCode(202)
    public async lifecycle(
        @AuthenticatedAdminUser() adminUser: Principal.AdminUser,
        @ZodParam('workspaceId', Workspace.Id) workspaceId: Workspace.Id,
        @ZodParam('action', Workspace.Lifecycle.Action) action: Workspace.Lifecycle.Action,
    ): Promise<Workspace.API.Lifecycle.Response> {
        await this.workspaceAdminService.assertLifecycleAllowed(adminUser, workspaceId);

        void this.workspaceAdminService.lifecycle(adminUser, workspaceId, action)
            .catch((error: unknown) => this.logger.error(`${action} for ${workspaceId} failed: ${error instanceof Error ? error.message : error}`));

        return {};
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
