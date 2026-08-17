import { Module } from '@nestjs/common';
import { FleetModule } from '@/services/Fleet/fleet.module';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';

@Module({
    imports: [FleetModule],
    controllers: [WorkspaceController],
    providers: [WorkspaceService],
})
export class WorkspaceModule { }
