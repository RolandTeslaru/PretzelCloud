import { Body, Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { Workspace } from '@pretzel-cloud/shared/domain';
import { UserAuthGuard } from '@/auth/guards/user-auth.guard';
import { OperatorGuard } from '@/auth/guards/operator.guard';
import { WorkspaceService } from '@/services/Workspace/workspace.service';
import { PortalDB } from '@/db/portal';

/** Fleet operations, for whoever runs the fleet. Never reachable by a customer. */
@Controller('admin')
@UseGuards(UserAuthGuard, OperatorGuard)
export class AdminController {

    constructor(private readonly workspaceService: WorkspaceService) {}

    @Get('workspaces')
    public async list() {
        const rows = await PortalDB.asService('list workspaces for operator', (db) =>
            db
                .selectFrom('workspaces')
                .select(['id', 'display_name', 'plan', 'lifecycle_state', 'frozen_reason', 'owner_id', 'created_at'])
                .orderBy('created_at', 'desc')
                .execute());

        return { workspaces: rows };
    }

    @Post('workspaces/:workspaceId/freeze')
    public async freeze(
        @Param('workspaceId') workspaceId: string,
        @Body() body: { reason?: string },
    ): Promise<Record<string, never>> {
        await this.workspaceService.freeze(
            Workspace.Id.parse(workspaceId),
            body?.reason?.trim() || 'This workspace has been suspended by an operator.',
        );

        return {};
    }

    @Post('workspaces/:workspaceId/unfreeze')
    public async unfreeze(@Param('workspaceId') workspaceId: string): Promise<Record<string, never>> {
        await this.workspaceService.unfreeze(Workspace.Id.parse(workspaceId));

        return {};
    }
}
