import { Controller, Get } from '@nestjs/common';
import { Plan } from '@pretzel-cloud/shared/domain';
import { PlanRegistry } from './plan.registry';

/** What is on sale. Open: a price is what the product tells anyone who asks. */
@Controller('plans')
export class PlanController {

    constructor(private readonly planRegistry: PlanRegistry) {}

    @Get()
    public list(): Plan.API.List.Response {
        return { plans: this.planRegistry.list() };
    }
}
