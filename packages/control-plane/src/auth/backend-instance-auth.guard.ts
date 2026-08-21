import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { Workspace } from '@pretzel-cloud/shared/domain';
import { TtlCache } from '@pretzel-cloud/shared/server/ttl-cache';
import { FleetDB } from '@/db/fleet';

export const BACKEND_TOKEN_HEADER = 'x-workspace-backend-token';

/**
 * Short on purpose: the token is the credential itself, so a rotation or a
 * destroyed workspace stays accepted for this long. A minute is the window we
 * are willing to lag by in exchange for not reading the row per call.
 */
const TOKEN_TTL_MS = 60_000;
const TOKEN_CACHE_MAX = 10_000;

const matches = (given: string, expected: string): boolean => {
    const a = Buffer.from(given);
    const b = Buffer.from(expected);

    return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * A workspace's own backend, calling upward. Not a user and not the router: the
 * token is per workspace, held only by the backend role, and only ever proves
 * the workspace named in the path.
 */
@Injectable()
export class BackendInstanceAuthGuard implements CanActivate {

    private readonly tokens = new TtlCache<Workspace.Id, string>(TOKEN_TTL_MS, TOKEN_CACHE_MAX);

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<Request>();

        const given = request.headers[BACKEND_TOKEN_HEADER];

        if (typeof given !== 'string' || given.length === 0)
            throw new UnauthorizedException('Missing backend token');

        const workspaceId = Workspace.Id.safeParse(request.params.workspaceId);

        if (!workspaceId.success)
            throw new UnauthorizedException('Invalid workspace');

        const expected = await this.expectedToken(workspaceId.data);

        if (!expected || !matches(given, expected))
            throw new UnauthorizedException('Invalid backend token');

        return true;
    }

    private async expectedToken(workspaceId: Workspace.Id): Promise<string | undefined> {
        const cached = this.tokens.get(workspaceId);

        if (cached)
            return cached;

        const row = await FleetDB.asService('read backend token', (trx) =>
            trx
                .selectFrom('workspace_secrets')
                .select('backend_token')
                .where('workspace_id', '=', workspaceId)
                .executeTakeFirst());

        // A miss is not cached: an unknown workspace is the shape a scan takes,
        // and remembering it would keep a real one out after it is provisioned.
        if (!row)
            return undefined;

        this.tokens.set(workspaceId, row.backend_token);

        return row.backend_token;
    }
}
