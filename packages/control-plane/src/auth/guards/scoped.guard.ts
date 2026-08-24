import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Workspace } from '@pretzel-cloud/shared/domain';
import { PermissionService } from '@/services/Permission/permission.service';
import { ScopeName, Scopes, SCOPE, REQUIRE_OWNER } from '../scopes';

export type ScopedRequest = Request & { scopes?: Partial<Scopes> };

/**
 * Resolves the resource a route declares with `@Scoped(...)`, in one query, and
 * hangs it on the request.
 *
 * Membership and the row come back together: the join *is* the access check, so
 * there is no window where one is known and the other isn't. Nothing is cached
 * between requests — plan, owner and status all change underneath us, and a
 * stale scope would authorize against a subscription that has since lapsed.
 */
@Injectable()
export class ScopedGuard implements CanActivate {

    constructor(
        private readonly reflector: Reflector,
        private readonly permissions: PermissionService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const name = this.reflector.getAllAndOverride<ScopeName | undefined>(
            SCOPE,
            [context.getHandler(), context.getClass()],
        );

        if (!name)
            return true;

        const request = context.switchToHttp().getRequest<ScopedRequest>();

        // The session path only: a machine or service principal has no membership.
        if (request.principal?.type !== 'user')
            throw new ForbiddenException('Not authenticated');

        const workspace = await this.resolveWorkspace(request);

        if (this.reflector.getAllAndOverride<boolean | undefined>(REQUIRE_OWNER, [context.getHandler(), context.getClass()])
            && workspace.ownerId !== request.principal.userId)
            throw new ForbiddenException('Only the workspace owner can do that');

        request.scopes = { ...request.scopes, [name]: workspace };

        return true;
    }

    private async resolveWorkspace(request: ScopedRequest): Promise<Workspace> {
        const parsed = Workspace.Id.safeParse(request.params.workspaceId);

        if (!parsed.success)
            throw new NotFoundException('No such workspace');

        if (request.principal?.type !== 'user')
            throw new ForbiddenException('Not authenticated');

        const workspace = await this.permissions.getWorkspaceForMember(request.principal, parsed.data);

        // Not a member and not existing are the same answer on purpose: a
        // membership probe should not distinguish them.
        if (!workspace)
            throw new NotFoundException('No such workspace');

        return workspace;
    }
}
