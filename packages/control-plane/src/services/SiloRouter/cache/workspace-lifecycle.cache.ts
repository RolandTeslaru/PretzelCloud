import { Injectable, Logger } from '@nestjs/common';
import { Workspace } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';
import { GlobalCaching, GlobalCachingService } from '@/services/Caching/caching.service';

// Every write goes through WorkspaceService, which invalidates. Finite as a backstop.
const TTL_MS = 60 * 60_000;
const MAX    = 10_000;

// Replicated: no secret, and a peer's lookup warms everyone.
const CHANNEL = GlobalCaching.Channel.parse('cache:lifecycle');

// What a workspace should be doing, by id.
@Injectable()
export class WorkspaceLifecycleCache {

    private readonly logger = new Logger(WorkspaceLifecycleCache.name);

    constructor(private readonly globalCache: GlobalCachingService) {
        this.globalCache.create(CHANNEL, TTL_MS, MAX, true);
    }




    public async get(workspaceId: Workspace.Id): Promise<WorkspaceLifecycleCache.Entry> {
        const cached = this.globalCache.get(CHANNEL, workspaceId) as WorkspaceLifecycleCache.Entry | undefined;

        if (cached)
            return cached;

        const found = await this.lookup(workspaceId);

        this.globalCache.set(CHANNEL, workspaceId, found);

        return found;
    }




    public invalidate(workspaceId: Workspace.Id): void {
        this.globalCache.delete(CHANNEL, workspaceId);
    }




    public clear(): void {
        this.globalCache.clear(CHANNEL);

        this.logger.warn('Lifecycle cache cleared');
    }




    public get size() {
        return this.globalCache.size(CHANNEL);
    }




    private async lookup(workspaceId: Workspace.Id): Promise<WorkspaceLifecycleCache.Entry> {
        const row = await PortalDB.asService('resolve lifecycle', (db) =>
            db
                .selectFrom('workspaces')
                .select(['lifecycle_state', 'disabled_reason'])
                .where('id', '=', workspaceId)
                .executeTakeFirst());

        return {
            lifecycleState: row?.lifecycle_state ?? 'running',
            disabledReason: row?.disabled_reason ?? null,
        };
    }
}

export namespace WorkspaceLifecycleCache {

    export type Entry = {
        lifecycleState: Workspace.Lifecycle.State;
        disabledReason: string | null;
    };
}
