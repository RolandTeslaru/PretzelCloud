import { Injectable, Logger } from '@nestjs/common';
import { Workspace } from '@pretzel-cloud/shared/domain';
import { HardwareService } from '@/services/Fleet/Hardware/hardware.service';
import { GlobalCaching, GlobalCachingService } from '@/services/Caching/caching.service';

// Short: the driver changes this without telling anyone. A stale hit is caught by the forward failing.
const TTL_MS = 30_000;
const MAX    = 10_000;

const CHANNEL = GlobalCaching.Channel.parse('cache:targets');

// Where a workspace's backend answers, by id. Null is cached too: a sleeping
// workspace draws a retry storm that must not reach the driver.
@Injectable()
export class TargetCache {

    private readonly logger = new Logger(TargetCache.name);

    constructor(
        private readonly hardwareService: HardwareService,
        private readonly globalCache:     GlobalCachingService,
    ) {
        this.globalCache.create(CHANNEL, TTL_MS, MAX, false);
    }




    public async get(workspaceId: Workspace.Id): Promise<URL | null> {
        const cached = this.globalCache.get(CHANNEL, workspaceId) as URL | null | undefined;

        if (cached !== undefined)
            return cached;

        const found = await this.hardwareService.getBackendAddress(workspaceId);

        this.globalCache.set(CHANNEL, workspaceId, found);

        return found;
    }




    public set(workspaceId: Workspace.Id, address: URL | null): void {
        this.globalCache.set(CHANNEL, workspaceId, address);
    }




    public invalidate(workspaceId: Workspace.Id): void {
        this.globalCache.delete(CHANNEL, workspaceId);
    }




    public clear(): void {
        this.globalCache.clear(CHANNEL);

        this.logger.warn('Target cache cleared');
    }




    public get size() {
        return this.globalCache.size(CHANNEL);
    }
}
