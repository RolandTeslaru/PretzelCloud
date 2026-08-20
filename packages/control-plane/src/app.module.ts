import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { FleetModule } from './services/Fleet/fleet.module';
import { RouterModule } from './services/WorkspaceRouter/router.module';
import { WorkspaceSessionModule } from './services/WorkspaceSession/session.module';
import { UserModule } from './services/User/user.module';
import { WorkspaceModule } from './services/Workspace/workspace.module';
import { ZodExceptionFilter } from './filters/zod-exception.filter';

@Module({
    imports: [AuthModule, FleetModule, RouterModule, WorkspaceSessionModule, UserModule, WorkspaceModule],
    providers: [
        { provide: APP_FILTER, useClass: ZodExceptionFilter },
    ],
})
export class AppModule { }
