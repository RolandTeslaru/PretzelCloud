import { Controller, Delete, Get, HttpCode, UseGuards } from '@nestjs/common';
import { Admin, User } from '@pretzel-cloud/shared/domain';
import { ZodBody, ZodParam } from '@pretzel-cloud/shared/server/pipes/zod.pipe';
import { UserAuthGuard } from '@/auth/guards/user-auth.guard';
import { AdminGuard } from '@/auth/guards/admin.guard';
import { AuthenticatedAdminUser } from '@/auth/identity/principal.decorator';
import { Principal } from '@/auth/identity/principal';
import { UserAdminService } from './user.admin.service';

@Controller('admin/users')
@UseGuards(UserAuthGuard, AdminGuard)
export class UserAdminController {
    constructor(private readonly userAdminService: UserAdminService) {}

    @Get()
    public async list(
        @AuthenticatedAdminUser() adminUser: Principal.AdminUser,
    ): Promise<Admin.API.Users.List.Response> {
        return { users: await this.userAdminService.list(adminUser) };
    }

    @Delete(':userId')
    @HttpCode(204)
    public async delete(
        @AuthenticatedAdminUser() adminUser: Principal.AdminUser,
        @ZodParam('userId', User.Id) userId: User.Id,
        @ZodBody(Admin.API.Users.Delete.Request) body: Admin.API.Users.Delete.Request,
    ): Promise<void> {
        await this.userAdminService.delete(adminUser, userId, body.confirmation);
    }
}
