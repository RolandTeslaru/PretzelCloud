import { Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { Workspace } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';
import { FleetDB } from '@/db/fleet';
import { Principal } from '@/auth/identity/principal';
import { WorkspaceRepository } from '@/services/Workspace/workspace.repository';
import { GlobalCaching, GlobalCachingService } from '@/services/Caching/caching.service';
import { PlanRegistry } from '@/services/Plan/plan.registry';

/** What the account says. Roles inside a workspace are that workspace's own. */
export type AccountRole = 'owner' | 'member';

/**
 * A silo's token changes only when it is rotated or the workspace goes away,
 * and both of those invalidate here directly. The window is the backstop for
 * anything that forgets to.
 */
const CLOUD_TOKEN_TTL_MS = 600_000;
const CLOUD_TOKEN_CACHE_MAX = 10_000;

/**
 * Shared so a rotation reaches every instance rather than each waiting out its
 * own window. The value stays local — it is the credential itself.
 */
const CLOUD_TOKEN_CHANNEL = GlobalCaching.Channel.parse('cache:silo-cloud-tokens');

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

    constructor(
        private readonly workspaceRepository: WorkspaceRepository,
        private readonly planRegistry:      PlanRegistry,
        private readonly globalCachingService: GlobalCachingService,
    ) {
        this.globalCachingService.create(CLOUD_TOKEN_CHANNEL, CLOUD_TOKEN_TTL_MS, CLOUD_TOKEN_CACHE_MAX, false);
    }


    /** Whether this token is the one that proves the named workspace. */
    public async doesWorkspaceMatchCloudToken(workspaceId: Workspace.Id, given: string): Promise<boolean> {
        const expected = await this.getCloudToken(workspaceId);

        return Boolean(expected) && matches(given, expected!);
    }

    /** Call when the token is rotated or the workspace is torn down. */
    public invalidateCloudToken(workspaceId: Workspace.Id): void {
        this.globalCachingService.delete(CLOUD_TOKEN_CHANNEL, workspaceId);
    }

    private async getCloudToken(workspaceId: Workspace.Id): Promise<string | undefined> {
        const cached = this.globalCachingService.get(CLOUD_TOKEN_CHANNEL, workspaceId) as string | undefined;

        if (cached)
            return cached;

        const row = await FleetDB.asService('read cloud token', (trx) =>
            trx
                .selectFrom('silo_secrets')
                .select('cloud_token')
                .where('workspace_id', '=', workspaceId)
                .executeTakeFirst());

        // A miss is not cached: an unknown workspace is the shape a scan takes,
        // and remembering it would keep a real one out after it is provisioned.
        if (!row)
            return undefined;

        this.globalCachingService.set(CLOUD_TOKEN_CHANNEL, workspaceId, row.cloud_token);

        return row.cloud_token;
    }

    /** The workspace, or null when it does not exist or is not theirs to see. */
    public async getWorkspaceForMember(principal: Principal.User, workspaceId: Workspace.Id): Promise<Workspace | null> {
        return this.workspaceRepository.getForUser(principal, workspaceId);
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

        return rows.map((row) => {
            const workspaceRow = PortalDB.Workspace.Row.parse(row);

            const plan = this.planRegistry.get(workspaceRow.plan_id)

            return PortalDB.Workspace.toDomain(workspaceRow, plan);
        });
    }
}
