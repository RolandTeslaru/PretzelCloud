import { Controller, Delete, Get, HttpCode, Patch, Put, UseGuards } from '@nestjs/common';
import { User } from '@pretzel-cloud/shared/domain';
import { ZodBody } from '@pretzel-cloud/shared/server/pipes/zod.pipe';
import { UserAuthGuard } from '@/auth/guards/user-auth.guard';
import { AuthenticatedUser } from '@/auth/identity/principal.decorator';
import { Principal } from '@/auth/identity/principal';
import { UserService } from './user.service';

const API = User.API;

/**
 * The caller's own profile. Credentials belong to the issuer and are never
 * reachable from here — this controller only ever touches the profile row.
 */
@Controller('me')
@UseGuards(UserAuthGuard)
export class UserController {

    constructor(private readonly userService: UserService) {}

    /** Idempotent, so the portal can call it on every boot. */
    @Put()
    async register(
        @AuthenticatedUser() principal: Principal.User,
        @ZodBody(API.Register.Request) body: User.API.Register.Request,
    ): Promise<User.API.Register.Response> {
        return { user: await this.userService.register(principal, body) };
    }

    @Get()
    async get(
        @AuthenticatedUser() principal: Principal.User,
    ): Promise<User.API.Get.Response> {
        return { user: await this.userService.get(principal) };
    }

    /** Closes the account. Workspaces are not touched; one still owned refuses. */
    @Delete()
    @HttpCode(204)
    async delete(
        @AuthenticatedUser() principal: Principal.User,
    ): Promise<void> {
        await this.userService.delete(principal, principal.userId);
    }

    @Patch()
    async update(
        @AuthenticatedUser() principal: Principal.User,
        @ZodBody(API.Update.Request) body: User.API.Update.Request,
    ): Promise<User.API.Update.Response> {
        return { user: await this.userService.update(principal, body) };
    }
}
