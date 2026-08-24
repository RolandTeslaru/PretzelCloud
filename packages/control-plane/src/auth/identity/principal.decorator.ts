import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { Principal } from './principal';

/** The caller. Populated by UserAuthGuard. */
export const AuthenticatedUser = createParamDecorator(
    (_: unknown, context: ExecutionContext): Principal.User => {
        const { principal } = context.switchToHttp().getRequest<Request>();

        if (principal?.type !== 'user')
            throw new UnauthorizedException('User principal required');

        return principal;
    },
);

/** The calling workspace. Populated by SiloAuthGuard. */
export const AuthenticatedSilo = createParamDecorator(
    (_: unknown, context: ExecutionContext): Principal.Silo => {
        const { principal } = context.switchToHttp().getRequest<Request>();

        if (principal?.type !== 'silo')
            throw new UnauthorizedException('Workspace principal required');

        return principal;
    },
);
