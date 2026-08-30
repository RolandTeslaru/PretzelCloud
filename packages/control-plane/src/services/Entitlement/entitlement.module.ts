import { Module } from '@nestjs/common';
import { EntitlementController } from './entitlement.controller';
import { EntitlementService } from './entitlement.service';
import { UsageRepository } from './usage.repository';

@Module({
    controllers: [EntitlementController],
    providers: [EntitlementService, UsageRepository],
    exports:   [EntitlementService],
})
export class EntitlementModule { }
