import { forwardRef, Module } from '@nestjs/common';
import { BillingModule } from '@/services/Billing/billing.module';
import { FleetModule } from '@/services/Fleet/fleet.module';
import { EntitlementModule } from '@/services/Entitlement/entitlement.module';
import { RouterModule } from '@/services/WorkspaceRouter/router.module';
import { RealtimeModule } from '@/services/Realtime/realtime.module';
import { WorkspaceController } from './workspace.controller';
import { SiloBackendLifecycleController } from './silo-backend-lifecycle.controller';
import { WorkspaceService } from './workspace.service';
import { SiloActivityService } from './silo-activity.service';

@Module({
    imports: [FleetModule, EntitlementModule, forwardRef(() => RouterModule), forwardRef(() => BillingModule), RealtimeModule],
    controllers: [WorkspaceController, SiloBackendLifecycleController],
    providers: [WorkspaceService, SiloActivityService],
    exports: [WorkspaceService, SiloActivityService],
})
export class WorkspaceModule { }
