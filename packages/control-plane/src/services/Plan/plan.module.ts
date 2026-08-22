import { Global, Module } from '@nestjs/common';
import { PlanRegistry } from './plan.registry';

// Global: the fleet, the activity sweep and billing all read plans, and a plan
// is a fact about the deployment rather than a dependency of any one service.
@Global()
@Module({
    providers: [PlanRegistry],
    exports:   [PlanRegistry],
})
export class PlanModule { }
