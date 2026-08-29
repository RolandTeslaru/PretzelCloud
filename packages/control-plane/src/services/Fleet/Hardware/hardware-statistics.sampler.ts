import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Workspace } from '@pretzel-cloud/shared/domain';
import { LockService } from '@/services/Locking/lock.service';
import { RealtimeGateway } from '@/services/Realtime/realtime.gateway';
import { RealtimeService } from '@/services/Realtime/realtime.service';
import { HardwareService } from './hardware.service';

const SAMPLE_INTERVAL_MS = 15_000;

/**
 * Publishes machine statistics onto the workspace channels somebody is
 * watching. Watching is the trigger: an unwatched workspace is never sampled,
 * and a parked one reads as nothing and publishes nothing.
 */
@Injectable()
export class HardwareStatisticsSampler implements OnModuleInit, OnModuleDestroy {

    private readonly logger = new Logger(HardwareStatisticsSampler.name);

    private timer?: NodeJS.Timeout;

    constructor(
        private readonly realtimeGateway: RealtimeGateway,
        private readonly realtimeService: RealtimeService,
        private readonly hardwareService: HardwareService,
        private readonly lockService:     LockService,
    ) {}




    public onModuleInit(): void {
        this.timer = setInterval(() => void this.sample(), SAMPLE_INTERVAL_MS);
    }




    public onModuleDestroy(): void {
        clearInterval(this.timer);
    }




    private async sample(): Promise<void> {
        for (const workspaceId of this.realtimeGateway.getSubscribedWorkspaceIds()) {
            // The claim outlives the work, so each window samples a workspace
            // once however many instances have watchers on it.
            const claimed = await this.lockService.claimWindow('hardware-statistics', workspaceId, SAMPLE_INTERVAL_MS - 1_000);

            if (!claimed)
                continue;

            try {
                const statistics = await this.hardwareService.getStatisticsForWorkspace(workspaceId);

                if (!statistics)
                    continue;

                const channel = Workspace.Event.getChannel(workspaceId);

                this.realtimeService.publish(channel, {
                    ...Workspace.Event.create('hardware:statistics', { statistics }),
                    channel,
                    workspaceId,
                });
            }
            catch (error) {
                this.logger.warn(`Sampling ${workspaceId} failed: ${(error as Error).message}`);
            }
        }
    }
}
