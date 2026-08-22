import { Module } from '@nestjs/common';
import { WorkspaceModule } from '@/services/Workspace/workspace.module';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { BillingWebhookController } from './billing-webhook.controller';

@Module({
    imports:     [WorkspaceModule],
    controllers: [BillingController, BillingWebhookController],
    providers:   [BillingService],
    exports:     [BillingService],
})
export class BillingModule { }
