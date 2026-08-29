import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { FleetModule } from './services/Fleet/fleet.module';
import { RouterModule } from './services/SiloRouter/router.module';
import { BillingModule } from './services/Billing/billing.module';
import { PlanModule } from './services/Plan/plan.module';
import { CachingModule } from './services/Caching/caching.module';
import { LockModule } from './services/Locking/lock.module';
import { EntitlementModule } from './services/Entitlement/entitlement.module';
import { AdminModule } from './services/Admin/admin.module';
import { PermissionModule } from './services/Permission/permission.module';
import { SiloSessionModule } from './services/SiloSession/session.module';
import { UserModule } from './services/User/user.module';
import { WorkspaceModule } from './services/Workspace/workspace.module';
import { RealtimeModule } from './services/Realtime/realtime.module';
import { ListingModule } from './services/Listing/listing.module';
import { ExtendedShelfModule } from './services/ExtendedShelf/extended-shelf.module';
import { ZodExceptionFilter } from './filters/zod-exception.filter';

// A ceiling for every route, raised or lowered where a route earns it. The
// silos carry their own; this is the control plane's own surface.
@Module({
    imports: [ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 600 }] }), PermissionModule, AdminModule, EntitlementModule, PlanModule, CachingModule, LockModule, BillingModule, AuthModule, FleetModule, RouterModule, SiloSessionModule, UserModule, WorkspaceModule, RealtimeModule, ListingModule, ExtendedShelfModule],
    providers: [
        { provide: APP_FILTER, useClass: ZodExceptionFilter },
        { provide: APP_GUARD,  useClass: ThrottlerGuard },
    ],
})
export class AppModule { }
