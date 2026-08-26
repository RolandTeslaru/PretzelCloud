import { forwardRef, Module } from '@nestjs/common';
import { WorkspaceModule } from '@/services/Workspace/workspace.module';
import { BillingService } from './billing.service';
import { StripeClient } from './stripe.client';
import { StripeEventHandlerService } from './stripe-event-handler.service';
import { BillingDatabase } from './billing.database';
import { BillingController } from './billing.controller';
import { BillingWebhookController } from './billing-webhook.controller';

@Module({
    imports:     [forwardRef(() => WorkspaceModule)],
    controllers: [BillingController, BillingWebhookController],
    providers:   [StripeClient, BillingService, StripeEventHandlerService, BillingDatabase],
    exports:     [BillingService],
})
export class BillingModule { }
