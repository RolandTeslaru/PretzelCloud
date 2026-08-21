import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { Workspace } from '@pretzel-cloud/shared/domain';
import { BackendInstanceAuthGuard } from '@/auth/backend-instance-auth.guard';
import { WorkspaceService } from './workspace.service';

/**
 * What a workspace's own backend may ask of the fleet — driving the machine it
 * hands work to.
 *
 * Its own controller rather than a route on the user-facing one: the caller is
 * a machine holding a per-workspace token, so the session and membership guards
 * that class applies would reject it.
 */
@Controller('workspaces')
@UseGuards(BackendInstanceAuthGuard)
export class SiloBackendLifecycleController {

    constructor(private readonly workspaces: WorkspaceService) {}

    @Post(':workspaceId/worker/wake')
    async wakeWorker(@Param('workspaceId') workspaceId: string): Promise<Record<string, never>> {
        // Parsed here rather than read from a scope: the scoped guard is the
        // user path's, and this caller is a machine.
        await this.workspaces.wakeWorker(Workspace.Id.parse(workspaceId));

        return {};
    }

    @Post(':workspaceId/worker/sleep')
    async sleepWorker(@Param('workspaceId') workspaceId: string): Promise<Record<string, never>> {
        await this.workspaces.sleepWorker(Workspace.Id.parse(workspaceId));

        return {};
    }
}
