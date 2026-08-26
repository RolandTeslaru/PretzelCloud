import { Controller, Delete, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { Workspace } from '@pretzel-cloud/shared/domain';
import { ZodBody } from '@pretzel-cloud/shared/server/pipes/zod.pipe';
import { UserAuthGuard } from '@/auth/guards/user-auth.guard';
import { ScopedGuard } from '@/auth/guards/scoped.guard';
import { Scoped, RequireOwner } from '@/auth/scopes';
import { WorkspaceScope, WorkspaceIdParam } from '@/auth/guarded-params';
import { AuthenticatedUser } from '@/auth/identity/principal.decorator';
import { Principal } from '@/auth/identity/principal';
import { Throttle } from '@nestjs/throttler';
import { WorkspaceService } from './workspace.service';

const API = Workspace.API;

/**
 * Account-level operations only. Who is in a workspace, and what they may do
 * inside it, is the workspace's own API — this one never answers that.
 */
@Controller('workspaces')
@UseGuards(UserAuthGuard, ScopedGuard)
export class WorkspaceController {

    constructor(private readonly workspaceService: WorkspaceService) {}

    @Get()
    async list(
        @AuthenticatedUser() principal: Principal.User,
    ): Promise<Workspace.API.List.Response> {
        return { workspaces: await this.workspaceService.list(principal) };
    }

    // A database, a role, containers and hostnames per call, with retries.
    @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
    @Post()
    async create(
        @AuthenticatedUser() principal: Principal.User,
        @ZodBody(API.Create.Request) body: Workspace.API.Create.Request,
    ): Promise<Workspace.API.Create.Response> {
        return { workspace: await this.workspaceService.create(principal, body.displayName) };
    }

    @Get(':workspaceId')
    @Scoped('workspace')
    async get(
        @WorkspaceScope() workspace: Workspace,
    ): Promise<Workspace.API.Get.Response> {
        // The guard already resolved it on this request.
        return { workspace };
    }

    @Patch(':workspaceId')
    @Scoped('workspace')
    @RequireOwner()
    async rename(
        @AuthenticatedUser() principal: Principal.User,
        @WorkspaceIdParam()  workspaceId: Workspace.Id,
        @ZodBody(API.Rename.Request) body: Workspace.API.Rename.Request,
    ): Promise<Workspace.API.Rename.Response> {
        await this.workspaceService.rename(principal, workspaceId, body.displayName);

        return {};
    }

    @Patch(':workspaceId/subdomain')
    @Scoped('workspace')
    @RequireOwner()
    async setSubdomain(
        @AuthenticatedUser() principal: Principal.User,
        @WorkspaceScope() workspace: Workspace,
        @ZodBody(API.SetSubdomain.Request) body: Workspace.API.SetSubdomain.Request,
    ): Promise<Workspace.API.SetSubdomain.Response> {
        await this.workspaceService.setSubdomain(principal, workspace, body.subdomain);

        return {};
    }

    @Patch(':workspaceId/plan')
    @Scoped('workspace')
    @RequireOwner()
    async setPlan(
        @WorkspaceScope() workspace: Workspace,
        @ZodBody(API.SetPlan.Request) body: Workspace.API.SetPlan.Request,
    ): Promise<Workspace.API.SetPlan.Response> {
        await this.workspaceService.setPlan(workspace.id, workspace.ownerId, body.plan);

        return {};
    }

    @Post(':workspaceId/start')
    @Scoped('workspace')
    @RequireOwner()
    async start(@WorkspaceIdParam() workspaceId: Workspace.Id): Promise<Workspace.API.Lifecycle.Response> {
        await this.workspaceService.start(workspaceId);

        return {};
    }

    @Post(':workspaceId/stop')
    @Scoped('workspace')
    @RequireOwner()
    async stop(@WorkspaceIdParam() workspaceId: Workspace.Id): Promise<Workspace.API.Lifecycle.Response> {
        await this.workspaceService.stop(workspaceId);

        return {};
    }

    @Post(':workspaceId/suspend')
    @Scoped('workspace')
    @RequireOwner()
    async suspend(@WorkspaceIdParam() workspaceId: Workspace.Id): Promise<Workspace.API.Lifecycle.Response> {
        await this.workspaceService.suspend(workspaceId);

        return {};
    }

    @Post(':workspaceId/rebuild')
    @Scoped('workspace')
    @RequireOwner()
    async rebuild(@WorkspaceScope() workspace: Workspace): Promise<Workspace.API.Lifecycle.Response> {
        await this.workspaceService.rebuild(workspace.id, workspace.ownerId, workspace.plan);

        return {};
    }

    @Post(':workspaceId/restart')
    @Scoped('workspace')
    @RequireOwner()
    async restart(@WorkspaceIdParam() workspaceId: Workspace.Id): Promise<Workspace.API.Lifecycle.Response> {
        await this.workspaceService.restart(workspaceId);

        return {};
    }


    @Delete(':workspaceId')
    @Scoped('workspace')
    @RequireOwner()
    async destroy(
        @AuthenticatedUser() principal: Principal.User,
        @WorkspaceIdParam() workspaceId: Workspace.Id,
    ): Promise<Workspace.API.Destroy.Response> {
        await this.workspaceService.destroy(principal, workspaceId);

        return {};
    }
}
