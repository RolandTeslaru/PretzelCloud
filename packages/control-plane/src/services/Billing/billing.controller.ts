import { Controller, Post, UseGuards } from '@nestjs/common';
import { Workspace } from '@pretzel-cloud/shared/domain';
import { ZodBody } from '@pretzel-cloud/shared/server/pipes/zod.pipe';
import { UserAuthGuard } from '@/auth/user-auth.guard';
import { ScopedGuard } from '@/auth/scoped.guard';
import { Scoped, RequireOwner } from '@/auth/scopes';
import { WorkspaceScope } from '@/auth/scope.decorator';
import { AuthenticatedUser } from '@/auth/principal.decorator';
import { Principal } from '@/auth/principal';
import { BillingService } from './billing.service';

const getPortalAppOrigin = () => process.env.PORTAL_URL ?? 'http://localhost:5174';

/** Paying for a workspace. Only its owner may. */
@Controller('billing')
@UseGuards(UserAuthGuard, ScopedGuard)
export class BillingController {

    constructor(private readonly billing: BillingService) {}

    @Post('workspaces/:workspaceId/plan')
    @Scoped('workspace')
    @RequireOwner()
    async changePlan(
        @AuthenticatedUser() principal: Principal.User,
        @WorkspaceScope() workspace: Workspace,
        @ZodBody(Workspace.API.SetPlan.Request) body: Workspace.API.SetPlan.Request,
    ): Promise<{ url: string | null }> {
        return this.billing.changePlan(principal, workspace, body.plan, getPortalAppOrigin());
    }

    @Post('portal')
    async portal(
        @AuthenticatedUser() principal: Principal.User,
    ): Promise<{ url: string }> {
        return { url: await this.billing.getStripeBillingPortalUrl(principal, `${getPortalAppOrigin()}/workspaces`) };
    }
}
