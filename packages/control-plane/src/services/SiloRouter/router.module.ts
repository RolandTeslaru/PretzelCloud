import { forwardRef, Module } from '@nestjs/common';
import { FleetModule } from '@/services/Fleet/fleet.module';
import { EntitlementModule } from '@/services/Entitlement/entitlement.module';
import { WorkspaceModule } from '@/services/Workspace/workspace.module';
import { HostCache } from './host.cache';
import { Router } from './router.service';
import { ProxyService } from './proxy.service';

@Module({
    imports:   [FleetModule, EntitlementModule, forwardRef(() => WorkspaceModule)],
    providers: [HostCache, Router, ProxyService],
    exports:   [Router],
})
export class RouterModule { }
