import { Module } from '@nestjs/common';
import { FleetModule } from '@/services/Fleet/fleet.module';
import { RouterModule } from '@/services/WorkspaceRouter/router.module';
import { RealtimeModule } from '@/services/Realtime/realtime.module';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';

@Module({
    imports: [FleetModule, RouterModule, RealtimeModule],
    controllers: [WorkspaceController],
    providers: [WorkspaceService],
})
export class WorkspaceModule { }
