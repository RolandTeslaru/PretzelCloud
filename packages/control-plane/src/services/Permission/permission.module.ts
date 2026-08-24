import { forwardRef, Global, Module } from '@nestjs/common';
import { WorkspaceModule } from '@/services/Workspace/workspace.module';
import { PermissionService } from './permission.service';

// Global: guards ask it before any feature module is resolved, and services ask
// it after, so an import edge either way would be the wrong shape.
@Global()
@Module({
    imports:   [forwardRef(() => WorkspaceModule)],
    providers: [PermissionService],
    exports:   [PermissionService],
})
export class PermissionModule { }
