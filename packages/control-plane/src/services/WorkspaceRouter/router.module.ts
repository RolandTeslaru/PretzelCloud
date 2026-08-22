import { forwardRef, Module } from '@nestjs/common';
import { FleetModule } from '@/services/Fleet/fleet.module';
import { WorkspaceModule } from '@/services/Workspace/workspace.module';
import { Router } from './router.service';
import { ProxyService } from './proxy.service';

@Module({
    imports:   [FleetModule, forwardRef(() => WorkspaceModule)],
    providers: [Router, ProxyService],
    exports:   [Router],
})
export class RouterModule { }
