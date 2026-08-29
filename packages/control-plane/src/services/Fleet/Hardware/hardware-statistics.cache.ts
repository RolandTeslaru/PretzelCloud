import { Injectable } from '@nestjs/common';
import { Workspace } from '@pretzel-cloud/shared/domain';
import { GlobalCaching, GlobalCachingService } from '@/services/Caching/caching.service';

const CHANNEL = GlobalCaching.Channel.parse('cache:hardware-statistics');

// Older than this and the reading describes machines that may no longer run
// that way; the grid is better off empty than confidently stale.
const TTL_MS = 60_000;

const MAX_ENTRIES = 10_000;

/** The freshest reading per workspace, shared across instances. */
@Injectable()
export class HardwareStatisticsCache {

    constructor(private readonly globalCachingService: GlobalCachingService) {
        this.globalCachingService.create(CHANNEL, TTL_MS, MAX_ENTRIES);
    }




    public set(workspaceId: Workspace.Id, statistics: Workspace.HardwareStatistics): void {
        this.globalCachingService.set(CHANNEL, workspaceId, statistics);
    }




    /** One replication message for the whole tick, not one per workspace. */
    public setBatch(readings: Array<[Workspace.Id, Workspace.HardwareStatistics]>): void {
        this.globalCachingService.setBatch(CHANNEL, readings);
    }




    public get(workspaceId: Workspace.Id): Workspace.HardwareStatistics | undefined {
        return this.globalCachingService.get(CHANNEL, workspaceId) as Workspace.HardwareStatistics | undefined;
    }
}
