import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Operator-only. Listed by id in `OPERATOR_USER_IDS`, so nothing the app can
 * write grants it. Answers 404 rather than 403: a refusal confirms the surface.
 */
@Injectable()
export class OperatorGuard implements CanActivate {

    public canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest<Request>();

        if (request.principal?.type !== 'user')
            throw new NotFoundException();

        const operators = (process.env.OPERATOR_USER_IDS ?? '')
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean);

        // Empty means nobody, never everybody.
        if (!operators.includes(request.principal.userId))
            throw new NotFoundException();

        return true;
    }
}
