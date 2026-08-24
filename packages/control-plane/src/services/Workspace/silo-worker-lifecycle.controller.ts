import { Controller, Post, UseGuards } from '@nestjs/common';
import { Workspace } from '@pretzel-cloud/shared/domain';
import { SiloAuthGuard } from '@/auth/guards/silo-auth.guard';
import { WorkspaceIdParam } from '@/auth/guarded-params';
import { Throttle } from '@nestjs/throttler';
import { WorkspaceService } from './workspace.service';

/**
 * What a workspace's own backend may ask of the fleet — driving the machine it
 * hands work to.
 *
 * Its own controller rather than a route on the user-facing one: the caller is
 * a machine holding a per-workspace token, so the session and membership guards
 * that class applies would reject it.
 */
// A backend calls these per enqueue, not per click.
@Throttle({ default: { limit: 600, ttl: 60_000 } })
@Controller('workspaces')
@UseGuards(SiloAuthGuard)
export class SiloWorkerLifecycleController {

    constructor(private readonly workspaces: WorkspaceService) {}

    @Post(':workspaceId/worker/wake')
    async wakeWorker(@WorkspaceIdParam() workspaceId: Workspace.Id): Promise<Record<string, never>> {
        await this.workspaces.wakeWorker(workspaceId);

        return {};
    }

    @Post(':workspaceId/worker/sleep')
    async sleepWorker(@WorkspaceIdParam() workspaceId: Workspace.Id): Promise<Record<string, never>> {
        await this.workspaces.sleepWorker(workspaceId);

        return {};
    }
}
