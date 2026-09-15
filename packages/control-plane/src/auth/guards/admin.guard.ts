import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AdminRepository } from '../admin.repository';
import { requireAdmin } from '../admin';

/** Admin-only, granted by `users.is_admin`. Answers 404 rather than 403: a refusal confirms the surface. */
@Injectable()
export class AdminGuard implements CanActivate {

    constructor(private readonly adminRepository: AdminRepository) {}

    public async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<Request>();

        request.adminUser = await requireAdmin(this.adminRepository, request.principal);

        return true;
    }
}
