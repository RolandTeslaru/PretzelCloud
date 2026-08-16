import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Workspace } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';
import { ScopeName, Scopes, SCOPE, REQUIRE_OWNER } from './scopes';

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

    constructor(private readonly reflector: Reflector) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const name = this.reflector.getAllAndOverride<ScopeName | undefined>(
            SCOPE,
            [context.getHandler(), context.getClass()],
        );

        if (!name)
            return true;

        const request = context.switchToHttp().getRequest<ScopedRequest>();

        if (!request.principal)
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

        const row = await PortalDB.asUser(request.principal!, (trx) =>
            trx
                .selectFrom('workspaces')
                .innerJoin('workspace_members', 'workspace_members.workspace_id', 'workspaces.id')
                .where('workspaces.id', '=', parsed.data)
                .where('workspace_members.user_id', '=', request.principal!.userId)
                .selectAll('workspaces')
                .executeTakeFirst(),
        );

        // Not a member and not existing are the same answer on purpose: a
        // membership probe should not distinguish them.
        if (!row)
            throw new NotFoundException('No such workspace');

        return PortalDB.Workspace.toDomain(PortalDB.Workspace.Row.parse(row));
    }
}
