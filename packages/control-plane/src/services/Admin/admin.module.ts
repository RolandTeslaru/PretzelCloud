import { Module } from '@nestjs/common';
import { WorkspaceModule } from '@/services/Workspace/workspace.module';
import { AdminController } from './admin.controller';

@Module({
    imports:     [WorkspaceModule],
    controllers: [AdminController],
})
export class AdminModule { }
