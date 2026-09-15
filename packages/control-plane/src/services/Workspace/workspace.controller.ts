import { Controller, Delete, Get, HttpCode, Logger, Patch, Post, UseGuards, Query } from '@nestjs/common';
import { Workspace } from '@pretzel-cloud/shared/domain';
import { ZodBody } from '@pretzel-cloud/shared/server/pipes/zod.pipe';
import { UserAuthGuard } from '@/auth/guards/user-auth.guard';
import { ScopedGuard } from '@/auth/guards/scoped.guard';
import { Scoped, RequireOwner, RequireEnabled } from '@/auth/scopes';
import { WorkspaceScope, WorkspaceIdParam } from '@/auth/guarded-params';
import { AuthenticatedUser } from '@/auth/identity/principal.decorator';
import { Principal } from '@/auth/identity/principal';
import { Throttle } from '@nestjs/throttler';
import { RefuseIfBusy } from '@/decorators/operation';
import { LockService } from '@/services/Locking/lock.service';
import { WorkspaceService } from './workspace.service';
import { HardwareStatisticsSampler } from '@/services/Fleet/Hardware/statistics.sampler';

const API = Workspace.API;

/**
 * Account-level operations only. Who is in a workspace, and what they may do
 * inside it, is the workspace's own API — this one never answers that.
 */
@Controller('workspaces')
@UseGuards(UserAuthGuard, ScopedGuard)
export class WorkspaceController {

    private readonly logger = new Logger(WorkspaceController.name);

    constructor(
        private readonly workspaceService:         WorkspaceService,
        private readonly hardwareStatisticsSampler: HardwareStatisticsSampler,
        public  readonly lockService:              LockService,
    ) {}

    @Get()
    async list(
        @AuthenticatedUser() principal: Principal.User,
        @Query('getHardwareStatistics') getHardwareStatistics?: string,
    ): Promise<Workspace.API.List.Response> {
        const workspaces = await this.workspaceService.list(principal);

        if (getHardwareStatistics !== 'true')
            return { workspaces };

        const readings = await Promise.all(workspaces.map(async (workspace) =>
            [workspace.id, await this.hardwareStatisticsSampler.get(workspace.id)] as const));

        const hardwareStatistics: NonNullable<Workspace.API.List.Response['hardwareStatistics']> = {};

        for (const [workspaceId, statistics] of readings) {
            if (statistics)
                hardwareStatistics[workspaceId] = statistics;
        }

        return { workspaces, hardwareStatistics };
    }

    // A database, a role, containers and hostnames per call, with retries.
    @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
    @Post()
    async create(
        @AuthenticatedUser() principal: Principal.User,
        @ZodBody(API.Create.Request) body: Workspace.API.Create.Request,
    ): Promise<Workspace.API.Create.Response> {
        return { workspace: await this.workspaceService.create(principal, body.displayName, body.region) };
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
        await this.workspaceService.setPlan(workspace.id, workspace.ownerId, body.planId);

        return {};
    }

    @Post(':workspaceId/start')
    @Scoped('workspace')
    @RequireOwner()
    @RequireEnabled()
    @RefuseIfBusy('workspace')
    @HttpCode(202)
    async start(@WorkspaceIdParam() workspaceId: Workspace.Id): Promise<Workspace.API.Lifecycle.Response> {
        // Accepted, not done: bringing a workspace up waits on machines, and a
        // browser holding the request for that long learns nothing it would not
        // hear from `transition:failed` or `lifecycle:changed` anyway.
        void this.workspaceService.start(workspaceId)
            .catch((error: unknown) => this.logger.error(`Starting ${workspaceId} failed: ${error instanceof Error ? error.message : error}`));

        return {};
    }

    @Post(':workspaceId/stop')
    @Scoped('workspace')
    @RequireOwner()
    @RequireEnabled()
    @RefuseIfBusy('workspace')
    @HttpCode(202)
    async stop(@WorkspaceIdParam() workspaceId: Workspace.Id): Promise<Workspace.API.Lifecycle.Response> {
        void this.workspaceService.stop(workspaceId)
            .catch((error: unknown) => this.logger.error(`Stopping ${workspaceId} failed: ${error instanceof Error ? error.message : error}`));

        return {};
    }

    @Post(':workspaceId/suspend')
    @Scoped('workspace')
    @RequireOwner()
    @RequireEnabled()
    @RefuseIfBusy('workspace')
    @HttpCode(202)
    async suspend(@WorkspaceIdParam() workspaceId: Workspace.Id): Promise<Workspace.API.Lifecycle.Response> {
        void this.workspaceService.suspend(workspaceId)
            .catch((error: unknown) => this.logger.error(`Suspending ${workspaceId} failed: ${error instanceof Error ? error.message : error}`));

        return {};
    }

    @Post(':workspaceId/rebuild')
    @Scoped('workspace')
    @RequireOwner()
    @RequireEnabled()
    @RefuseIfBusy('workspace')
    @HttpCode(202)
    async rebuild(@WorkspaceScope() workspace: Workspace): Promise<Workspace.API.Lifecycle.Response> {
        void this.workspaceService.rebuild(workspace.id, workspace.ownerId, workspace.plan.id)
            .catch((error: unknown) => this.logger.error(`Rebuilding ${workspace.id} failed: ${error instanceof Error ? error.message : error}`));

        return {};
    }

    @Post(':workspaceId/update')
    @Scoped('workspace')
    @RequireOwner()
    @RequireEnabled()
    @RefuseIfBusy('workspace')
    @HttpCode(202)
    async update(
        @WorkspaceScope() workspace: Workspace,
        @ZodBody(Workspace.API.Update.Request) body: Workspace.API.Update.Request,
    ): Promise<Workspace.API.Lifecycle.Response> {
        void this.workspaceService.updateToRelease(workspace.id, workspace.ownerId, workspace.plan.id, body.releaseId)
            .catch((error: unknown) => this.logger.error(`Updating ${workspace.id} failed: ${error instanceof Error ? error.message : error}`));

        return {};
    }

    @Post(':workspaceId/restart')
    @Scoped('workspace')
    @RequireOwner()
    @RequireEnabled()
    @RefuseIfBusy('workspace')
    @HttpCode(202)
    async restart(@WorkspaceIdParam() workspaceId: Workspace.Id): Promise<Workspace.API.Lifecycle.Response> {
        void this.workspaceService.restart(workspaceId)
            .catch((error: unknown) => this.logger.error(`Restarting ${workspaceId} failed: ${error instanceof Error ? error.message : error}`));

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
