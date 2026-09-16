import { Controller, Get, UseGuards } from '@nestjs/common';
import { Admin } from '@pretzel-cloud/shared/domain';
import { AdminGuard } from '@/auth/guards/admin.guard';
import { UserAuthGuard } from '@/auth/guards/user-auth.guard';
import { PlanRegistry } from './plan.registry';

@Controller('admin/plans')
@UseGuards(UserAuthGuard, AdminGuard)
export class PlanAdminController {

    constructor(private readonly planRegistry: PlanRegistry) {}

    @Get()
    public list(): Admin.API.Plans.Response {
        return { plans: this.planRegistry.listAll() };
    }
}
