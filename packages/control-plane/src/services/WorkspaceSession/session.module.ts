import { Module } from '@nestjs/common';
import { RouterModule } from '@/services/WorkspaceRouter/router.module';
import { WorkspaceTokenIssuerModule } from './token-issuer.module';
import { JwksController, WorkspaceSessionController } from './session.controller';

@Module({
    imports:     [WorkspaceTokenIssuerModule, RouterModule],
    controllers: [WorkspaceSessionController, JwksController],
})
export class WorkspaceSessionModule { }
