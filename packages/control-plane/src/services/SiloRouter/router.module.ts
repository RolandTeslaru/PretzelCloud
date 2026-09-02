import { forwardRef, Module } from '@nestjs/common';
import { FleetModule } from '@/services/Fleet/fleet.module';
import { EntitlementModule } from '@/services/Entitlement/entitlement.module';
import { WorkspaceModule } from '@/services/Workspace/workspace.module';
import { HostBelongingCache } from './cache/host-belonging.cache';
import { WorkspaceLifecycleCache } from './cache/workspace-lifecycle.cache';
import { TargetCache } from './cache/target.cache';
import { Router } from './router.service';
import { ProxyService } from './proxy.service';
import { TcpListener } from './tcp-listener.service';

@Module({
    imports:   [FleetModule, EntitlementModule, forwardRef(() => WorkspaceModule)],
    providers: [HostBelongingCache, WorkspaceLifecycleCache, TargetCache, Router, ProxyService, TcpListener],
    exports:   [Router],
})
export class RouterModule { }
