import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Realtime } from '@pretzel-cloud/shared/domain';
import { createRedisClient, createRedisSubscriber } from '@/utils/redis';

/**
 * The push channel between control plane instances.
 *
 * Redis rather than in-process fan-out: the API runs behind a load balancer, and
 * a client subscribed on one instance must still see an event published by
 * another. Browser-facing events are subscribed by the gateway, which holds its
 * own subscriber and fans out to sockets; this one is for the instances
 * themselves, which listen to each other with no browser involved.
 */
@Injectable()
export class RealtimeService implements OnModuleDestroy {

    private readonly logger = new Logger(RealtimeService.name);

    private readonly redisPub = createRedisClient('realtime.service.pub');

    private readonly redisSub = createRedisSubscriber('realtime.service.sub');

    private readonly handlers = new Map<Realtime.Channel, Set<(event: unknown) => void>>();

    constructor() {
        this.redisSub.on('message', (channel: string, serializedEvent: string) => {
            const handlers = this.handlers.get(Realtime.Channel.parse(channel));

            if (!handlers)
                return;

            try {
                const event: unknown = JSON.parse(serializedEvent);

                handlers.forEach((notify) => notify(event));
            }
            catch (error) {
                this.logger.warn(`Unreadable event on ${channel}: ${error instanceof Error ? error.message : error}`);
            }
        });
    }

    /** Fire and forget: a dropped event is not worth failing the operation that caused it. */
    publish<T extends Realtime.Event>(channel: Realtime.Channel, event: T): void {
        void this.redisPub.publish(channel, JSON.stringify(event));
    }

    /**
     * Every event on a channel, for as long as the process runs. Redis pub/sub
     * has no delivery guarantee, so a reconnecting instance misses what was
     * published meanwhile — a subscriber must not be the only thing keeping
     * something correct.
     */
    subscribe<T>(channel: Realtime.Channel, handler: (event: T) => void): void {
        const existing = this.handlers.get(channel);

        if (existing) {
            existing.add(handler as (event: unknown) => void);

            return;
        }

        this.handlers.set(channel, new Set([handler as (event: unknown) => void]));

        void this.redisSub.subscribe(channel);
    }




    onModuleDestroy() {
        this.redisPub.disconnect();

        this.redisSub.disconnect();
    }
}
