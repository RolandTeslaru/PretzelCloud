import { forwardRef, Module } from '@nestjs/common';
import { FleetModule } from '@/services/Fleet/fleet.module';
import { RouterModule } from '@/services/WorkspaceRouter/router.module';
import { RealtimeModule } from '@/services/Realtime/realtime.module';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceBackendController } from './workspace-backend.controller';
import { WorkspaceService } from './workspace.service';

@Module({
    imports: [FleetModule, forwardRef(() => RouterModule), RealtimeModule],
    controllers: [WorkspaceController, WorkspaceBackendController],
    providers: [WorkspaceService],
    exports: [WorkspaceService],
})
export class WorkspaceModule { }
