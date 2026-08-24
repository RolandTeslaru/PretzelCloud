import { forwardRef, Module } from '@nestjs/common';
import { BillingModule } from '@/services/Billing/billing.module';
import { FleetModule } from '@/services/Fleet/fleet.module';
import { EntitlementModule } from '@/services/Entitlement/entitlement.module';
import { RouterModule } from '@/services/WorkspaceRouter/router.module';
import { RealtimeModule } from '@/services/Realtime/realtime.module';
import { WorkspaceController } from './workspace.controller';
import { SiloWorkerLifecycleController } from './silo-worker-lifecycle.controller';
import { WorkspaceService } from './workspace.service';
import { WorkspaceDatabase } from './workspace.database';
import { UserModule } from '@/services/User/user.module';
import { ListingModule } from '@/services/Listing/listing.module';
import { SiloActivityService } from './silo-activity.service';

@Module({
    imports: [FleetModule, EntitlementModule, forwardRef(() => RouterModule), forwardRef(() => BillingModule), forwardRef(() => UserModule), RealtimeModule, ListingModule],
    controllers: [WorkspaceController, SiloWorkerLifecycleController],
    providers: [WorkspaceService, WorkspaceDatabase, SiloActivityService],
    exports: [WorkspaceService, WorkspaceDatabase, SiloActivityService],
})
export class WorkspaceModule { }
