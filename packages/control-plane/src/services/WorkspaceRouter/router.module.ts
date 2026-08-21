import { forwardRef, Module } from '@nestjs/common';
import { FleetModule } from '@/services/Fleet/fleet.module';
import { WorkspaceModule } from '@/services/Workspace/workspace.module';
import { WorkspaceRouter } from './router.service';
import { ProxyService } from './proxy.service';

@Module({
    imports:   [FleetModule, forwardRef(() => WorkspaceModule)],
    providers: [WorkspaceRouter, ProxyService],
    exports:   [WorkspaceRouter],
})
export class RouterModule { }
