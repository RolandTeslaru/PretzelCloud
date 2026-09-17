import { Controller, Post, UseGuards } from '@nestjs/common';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { ZodParam } from '@pretzel-cloud/shared/server/pipes/zod.pipe';
import { SiloAuthGuard } from '@/auth/guards/silo-auth.guard';
import { WorkspaceIdParam } from '@/auth/guarded-params';
import { Throttle } from '@nestjs/throttler';
import { HardwareService } from '@/services/Fleet/Hardware/hardware.service';

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

    constructor(private readonly hardware: HardwareService) {}

    @Post(':workspaceId/workers/:workerId/wake')
    async wakeWorker(
        @WorkspaceIdParam() workspaceId: Workspace.Id,
        @ZodParam('workerId', Fleet.Machine.Id) workerId: Fleet.Machine.Id,
    ): Promise<Record<string, never>> {
        // The job is already queued; the worker takes it once it has booted, so the platform is not waited on.
        await this.hardware.lifecycle.wakeWorker(workspaceId, workerId, { awaitSettled: false });

        return {};
    }

    @Post(':workspaceId/workers/:workerId/sleep')
    async sleepWorker(
        @WorkspaceIdParam() workspaceId: Workspace.Id,
        @ZodParam('workerId', Fleet.Machine.Id) workerId: Fleet.Machine.Id,
    ): Promise<Record<string, never>> {
        await this.hardware.lifecycle.sleepWorker(workspaceId, workerId);

        return {};
    }
}
