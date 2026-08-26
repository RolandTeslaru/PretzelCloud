import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Workspace } from '@pretzel-cloud/shared/domain';
import { UserAuthGuard } from '@/auth/guards/user-auth.guard';
import { ScopedGuard } from '@/auth/guards/scoped.guard';
import { Scoped } from '@/auth/scopes';
import { WorkspaceScope } from '@/auth/guarded-params';
import { EntitlementService } from './entitlement.service';

/**
 * What a workspace may run, and what it has run.
 *
 * The rows live in the fleet database, which carries no row policy — the scope
 * is the access check: it resolves the workspace through the caller's own
 * membership, and only its id then reaches the fleet.
 */
@Controller('entitlements')
@UseGuards(UserAuthGuard, ScopedGuard)
export class EntitlementController {

    constructor(private readonly entitlementService: EntitlementService) {}

    @Get('workspaces/:workspaceId/executions')
    @Scoped('workspace')
    public async listUsage(
        @WorkspaceScope() workspace: Workspace,
        @Query('window') window?: string,
    ): Promise<Workspace.API.ListUsage.Response> {
        // The window names a span; the server decides its bounds, so no client
        // clock reaches the query.
        const period = Workspace.Usage.getPeriodFromWindow(Workspace.Usage.Window.catch('week').parse(window));

        return { records: await this.entitlementService.executions.get(workspace.id, period) };
    }

    @Get('workspaces/:workspaceId/executions/series')
    @Scoped('workspace')
    public async getUsageSeries(
        @WorkspaceScope() workspace: Workspace,
    ): Promise<Workspace.API.GetUsageSeries.Response> {
        const period = await this.entitlementService.getBillingPeriod(workspace.id);
        const points = await this.entitlementService.executions.getDailyCounts(workspace.id, period);

        return { points: Workspace.Usage.getDailySeries(period, points) };
    }

    @Get('workspaces/:workspaceId/executions/report')
    @Scoped('workspace')
    public async getUsageReport(
        @WorkspaceScope() workspace: Workspace,
    ): Promise<Workspace.API.GetUsageReport.Response> {
        return this.entitlementService.getPeriodUsageReport(workspace.id);
    }
}
