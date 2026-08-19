import { Module } from '@nestjs/common';
import { FleetModule } from '@/services/Fleet/fleet.module';
import { WorkspaceRouter } from './router.service';
import { ProxyService } from './proxy.service';

@Module({
    imports:   [FleetModule],
    providers: [WorkspaceRouter, ProxyService],
    exports:   [WorkspaceRouter],
})
export class RouterModule { }
