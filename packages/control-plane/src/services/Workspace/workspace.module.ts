import { forwardRef, Module } from '@nestjs/common';
import { BillingModule } from '@/services/Billing/billing.module';
import { FleetModule } from '@/services/Fleet/fleet.module';
import { EntitlementModule } from '@/services/Entitlement/entitlement.module';
import { RouterModule } from '@/services/SiloRouter/router.module';
import { RealtimeModule } from '@/services/Realtime/realtime.module';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceAdminController } from './workspace.admin.controller';
import { SiloWorkerLifecycleController } from './silo-worker-lifecycle.controller';
import { WorkspaceService } from './workspace.service';
import { WorkspaceAdminService } from './workspace.admin.service';
import { WorkspaceMemberService } from './workspace-member.service';
import { WorkspaceAdminRepository } from './workspace.admin.repository';
import { WorkspaceRepository } from './workspace.repository';
import { UserModule } from '@/services/User/user.module';
import { ListingModule } from '@/services/Listing/listing.module';
import { SiloActivityService } from './silo-activity.service';

@Module({
    imports: [FleetModule, EntitlementModule, forwardRef(() => RouterModule), forwardRef(() => BillingModule), forwardRef(() => UserModule), RealtimeModule, ListingModule],
    controllers: [WorkspaceController, WorkspaceAdminController, SiloWorkerLifecycleController],
    providers: [WorkspaceService, WorkspaceAdminService, WorkspaceMemberService, WorkspaceRepository, WorkspaceAdminRepository, SiloActivityService],
    exports: [WorkspaceService, WorkspaceAdminService, WorkspaceMemberService, WorkspaceRepository, SiloActivityService],
})
export class WorkspaceModule { }
