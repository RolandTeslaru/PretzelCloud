import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Workspace } from '@pretzel-cloud/shared/domain';
import { LockService } from '@/services/Locking/lock.service';
import { RealtimeGateway } from '@/services/Realtime/realtime.gateway';
import { RealtimeService } from '@/services/Realtime/realtime.service';
import { HardwareStatisticsService } from './statistics.service';
import { SampleCache } from './sample.cache';

const SAMPLE_INTERVAL_MS = 15_000;

/**
 * emites machine statistics onto the workspace channels somebody is
 * watching. Watching is the trigger for the periodic pass: an unwatched
 * workspace is never swept, and a parked one reads as nothing and emites
 * nothing. A single workspace can still be sampled on demand.
 */
@Injectable()
export class HardwareStatisticsSampler implements OnModuleInit, OnModuleDestroy {

    private readonly logger = new Logger(HardwareStatisticsSampler.name);

    private timer?: NodeJS.Timeout;

    constructor(
        private readonly realtimeGateway: RealtimeGateway,
        private readonly realtimeService: RealtimeService,
        private readonly hardwareStatisticsService: HardwareStatisticsService,
        private readonly lockService:              LockService,
        private readonly sampleCache:  SampleCache,
    ) {}




    public onModuleInit(): void {
        this.timer = setInterval(() => void this.sampleAll(), SAMPLE_INTERVAL_MS);
    }




    public onModuleDestroy(): void {
        clearInterval(this.timer);
    }




    /** Cached when fresh; otherwise this one workspace is sampled now. */
    public async get(workspaceId: Workspace.Id): Promise<Workspace.HardwareStatistics | null> {
        const cached = this.sampleCache.get(workspaceId);

        if (cached)
            return cached;

        return this.sample(workspaceId);
    }





    public async sample(workspaceId: Workspace.Id): Promise<Workspace.HardwareStatistics | null> {
        const statistics = await this.hardwareStatisticsService.getStatistics(workspaceId);

        if (!statistics)
            return null;

        this.emit(workspaceId, statistics);

        this.sampleCache.set(workspaceId, statistics);

        return statistics;
    }




    /**
     * Forgets what was read, without reading again. The next `get` samples
     * afresh; a watcher is told on the sweep after this one.
     */
    public invalidate(workspaceId: Workspace.Id): void {
        this.sampleCache.invalidate(workspaceId);
    }




    private async sampleAll(): Promise<void> {
        const readings: Array<[Workspace.Id, Workspace.HardwareStatistics]> = [];

        for (const workspaceId of this.realtimeGateway.getSubscribedWorkspaceIds()) {
            // The claim outlives the work, so each window samples a workspace
            // once however many instances have watchers on it.
            const claimed = await this.lockService.claimWindow('hardware-statistics', workspaceId, SAMPLE_INTERVAL_MS - 1_000);

            if (!claimed)
                continue;

            try {
                const statistics = await this.hardwareStatisticsService.getStatistics(workspaceId);

                if (!statistics)
                    continue;

                readings.push([workspaceId, statistics]);

                this.emit(workspaceId, statistics);
            }
            catch (error) {
                this.logger.warn(`Sampling ${workspaceId} failed: ${(error as Error).message}`);
            }
        }

        // One replication message for the whole sweep, not one per workspace.
        this.sampleCache.setBatch(readings);
    }




    private emit(workspaceId: Workspace.Id, statistics: Workspace.HardwareStatistics): void {
        const channel = Workspace.Event.getChannel(workspaceId);

        this.realtimeService.publish(channel, {
            ...Workspace.Event.create('hardware:statistics', { statistics }),
            channel,
            workspaceId,
        });
    }
}
