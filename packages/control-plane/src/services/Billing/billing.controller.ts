import { Controller, Post, UseGuards } from '@nestjs/common';
import { Workspace } from '@pretzel-cloud/shared/domain';
import { ZodBody } from '@pretzel-cloud/shared/server/pipes/zod.pipe';
import { UserAuthGuard } from '@/auth/guards/user-auth.guard';
import { ScopedGuard } from '@/auth/guards/scoped.guard';
import { Scoped, RequireOwner } from '@/auth/scopes';
import { WorkspaceIdParam } from '@/auth/guarded-params';
import { AuthenticatedUser } from '@/auth/identity/principal.decorator';
import { Principal } from '@/auth/identity/principal';
import { Throttle } from '@nestjs/throttler';
import { BillingService } from './billing.service';

const getPortalAppOrigin = () => process.env.PORTAL_URL ?? 'http://localhost:5174';

/** Paying for a workspace. Only its owner may. Each route reaches the provider. */
@Throttle({ default: { limit: 20, ttl: 60_000 } })
@Controller('billing')
@UseGuards(UserAuthGuard, ScopedGuard)
export class BillingController {

    constructor(private readonly billingService: BillingService) {}

    @Post('workspaces/:workspaceId/plan')
    @Scoped('workspace')
    @RequireOwner()
    async changePlan(
        @AuthenticatedUser() principal: Principal.User,
        @WorkspaceIdParam() workspaceId: Workspace.Id,
        @ZodBody(Workspace.API.SetPlan.Request) body: Workspace.API.SetPlan.Request,
    ): Promise<{ url: string | null }> {
        return this.billingService.changePlan(principal, workspaceId, body.planId, getPortalAppOrigin());
    }

    @Post('portal')
    async portal(
        @AuthenticatedUser() principal: Principal.User,
    ): Promise<{ url: string }> {
        return { url: await this.billingService.getStripeBillingPortalUrl(principal, `${getPortalAppOrigin()}/workspaces`) };
    }
}
