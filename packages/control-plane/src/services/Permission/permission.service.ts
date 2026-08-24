import { Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { Workspace } from '@pretzel-cloud/shared/domain';
import { TtlCache } from '@pretzel-cloud/shared/server/ttl-cache';
import { PortalDB } from '@/db/portal';
import { FleetDB } from '@/db/fleet';
import { Principal } from '@/auth/identity/principal';
import { WorkspaceDatabase } from '@/services/Workspace/workspace.database';

/** What the account says. Roles inside a workspace are that workspace's own. */
export type AccountRole = 'owner' | 'member';

/**
 * A silo's token changes only when it is rotated or the workspace goes away,
 * and both of those invalidate here directly. The window is the backstop for
 * anything that forgets to.
 */
const CLOUD_TOKEN_TTL_MS = 600_000;
const CLOUD_TOKEN_CACHE_MAX = 10_000;

const matches = (given: string, expected: string): boolean => {
    const a = Buffer.from(given);
    const b = Buffer.from(expected);

    return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Who may reach what, asked as a question rather than restated as a join.
 *
 * Every read runs on the caller's own credential, so the row policies answer
 * alongside the query and there is no second copy of the rule to keep in step.
 */
@Injectable()
export class PermissionService {

    constructor(private readonly workspacesDb: WorkspaceDatabase) {}

    private readonly siloCloudTokenCache = new TtlCache<Workspace.Id, string>(CLOUD_TOKEN_TTL_MS, CLOUD_TOKEN_CACHE_MAX);

    /** Whether this token is the one that proves the named workspace. */
    public async doesWorkspaceMatchCloudToken(workspaceId: Workspace.Id, given: string): Promise<boolean> {
        const expected = await this.getCloudToken(workspaceId);

        return Boolean(expected) && matches(given, expected!);
    }

    /** Call when the token is rotated or the workspace is torn down. */
    public invalidateCloudToken(workspaceId: Workspace.Id): void {
        this.siloCloudTokenCache.delete(workspaceId);
    }

    private async getCloudToken(workspaceId: Workspace.Id): Promise<string | undefined> {
        const cached = this.siloCloudTokenCache.get(workspaceId);

        if (cached)
            return cached;

        const row = await FleetDB.asService('read cloud token', (trx) =>
            trx
                .selectFrom('workspace_secrets')
                .select('cloud_token')
                .where('workspace_id', '=', workspaceId)
                .executeTakeFirst());

        // A miss is not cached: an unknown workspace is the shape a scan takes,
        // and remembering it would keep a real one out after it is provisioned.
        if (!row)
            return undefined;

        this.siloCloudTokenCache.set(workspaceId, row.cloud_token);

        return row.cloud_token;
    }

    /** The workspace, or null when it does not exist or is not theirs to see. */
    public async getWorkspaceForMember(principal: Principal.User, workspaceId: Workspace.Id): Promise<Workspace | null> {
        return PortalDB.asUser(principal, (trx) => this.workspacesDb.getForUser(trx, workspaceId));
    }

    public async isMember(principal: Principal.User, workspaceId: Workspace.Id): Promise<boolean> {
        return Boolean(await this.getWorkspaceForMember(principal, workspaceId));
    }

    public async isOwner(principal: Principal.User, workspaceId: Workspace.Id): Promise<boolean> {
        return (await this.getAccountRole(principal, workspaceId)) === 'owner';
    }

    /** Null when they are neither, which reads the same as no such workspace. */
    public async getAccountRole(principal: Principal.User, workspaceId: Workspace.Id): Promise<AccountRole | null> {
        const workspace = await this.getWorkspaceForMember(principal, workspaceId);

        if (!workspace)
            return null;

        return workspace.ownerId === principal.userId ? 'owner' : 'member';
    }

    /** Every workspace they may see, newest first. */
    public async getWorkspacesForMember(principal: Principal.User): Promise<Workspace[]> {
        const rows = await PortalDB.asUser(principal, (trx) =>
            trx
                .selectFrom('workspaces')
                .innerJoin('workspace_members', 'workspace_members.workspace_id', 'workspaces.id')
                .where('workspace_members.user_id', '=', principal.userId)
                .selectAll('workspaces')
                .orderBy('workspaces.created_at', 'desc')
                .execute());

        return rows.map((row) => PortalDB.Workspace.toDomain(PortalDB.Workspace.Row.parse(row)));
    }
}
