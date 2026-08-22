import { Module } from '@nestjs/common';
import { EntitlementController } from './entitlement.controller';
import { EntitlementService } from './entitlement.service';
import { UsageDatabase } from './usage.database';

@Module({
    controllers: [EntitlementController],
    providers: [EntitlementService, UsageDatabase],
    exports:   [EntitlementService],
})
export class EntitlementModule { }
