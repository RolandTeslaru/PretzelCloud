import { Module } from '@nestjs/common';
import { WorkspaceModule } from '@/services/Workspace/workspace.module';
import { BillingService } from './billing.service';
import { BillingDatabase } from './billing.database';
import { BillingController } from './billing.controller';
import { BillingWebhookController } from './billing-webhook.controller';

@Module({
    imports:     [WorkspaceModule],
    controllers: [BillingController, BillingWebhookController],
    providers:   [BillingService, BillingDatabase],
    exports:     [BillingService],
})
export class BillingModule { }
