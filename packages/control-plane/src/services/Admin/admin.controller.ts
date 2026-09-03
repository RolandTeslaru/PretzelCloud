import { Body, Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { UserAuthGuard } from '@/auth/guards/user-auth.guard';
import { OperatorGuard } from '@/auth/guards/operator.guard';
import { ZodBody } from '@pretzel-cloud/shared/server/pipes/zod.pipe';
import { ReleaseService } from '@/services/Fleet/Release/release.service';
import { WorkspaceService } from '@/services/Workspace/workspace.service';
import { PortalDB } from '@/db/portal';

/** Fleet operations, for whoever runs the fleet. Never reachable by a customer. */
@Controller('admin')
@UseGuards(UserAuthGuard, OperatorGuard)
export class AdminController {

    constructor(
        private readonly workspaceService: WorkspaceService,
        private readonly releaseService:   ReleaseService,
    ) {}

    @Get('workspaces')
    public async list() {
        const rows = await PortalDB.asService('list workspaces for operator', (db) =>
            db
                .selectFrom('workspaces')
                .select(['id', 'display_name', 'plan_id', 'lifecycle_state', 'disabled_reason', 'owner_id', 'created_at'])
                .orderBy('created_at', 'desc')
                .execute());

        return { workspaces: rows };
    }

    /** The release pipeline's announce call: name plus digest-pinned refs, id minted here. */
    @Post('releases')
    public async createRelease(
        @ZodBody(Fleet.Release.API.Create.Request) body: Fleet.Release.API.Create.Request,
    ): Promise<Fleet.Release.API.Create.Response> {
        return { release: await this.releaseService.create(body.name, body.description ?? null, body) };
    }

    @Post('workspaces/:workspaceId/disable')
    public async disable(
        @Param('workspaceId') workspaceId: string,
        @Body() body: { reason?: string },
    ): Promise<Record<string, never>> {
        await this.workspaceService.disable(
            Workspace.Id.parse(workspaceId),
            body?.reason?.trim() || 'This workspace has been disabled by an operator.',
        );

        return {};
    }

    @Post('workspaces/:workspaceId/enable')
    public async enable(@Param('workspaceId') workspaceId: string): Promise<Record<string, never>> {
        await this.workspaceService.enable(Workspace.Id.parse(workspaceId));

        return {};
    }
}
