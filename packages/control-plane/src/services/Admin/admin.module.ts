import { Module } from '@nestjs/common';
import { FleetModule } from '@/services/Fleet/fleet.module';
import { WorkspaceModule } from '@/services/Workspace/workspace.module';
import { AdminController } from './admin.controller';

@Module({
    imports:     [WorkspaceModule, FleetModule],
    controllers: [AdminController],
})
export class AdminModule { }
