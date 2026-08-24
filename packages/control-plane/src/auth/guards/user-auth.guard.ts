import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { IdentityResolver } from '../identity/identity';

/**
 * Proves who is calling, and nothing else. Membership is per workspace and
 * scoped by the database, so this guard has no lookup to do.
 */
@Injectable()
export class UserAuthGuard implements CanActivate {

    constructor(private readonly identity: IdentityResolver) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<Request>();

        const principal = await this.identity.resolve(request);

        if (!principal)
            throw new UnauthorizedException('Not authenticated');

        request.principal = principal;

        return true;
    }
}
