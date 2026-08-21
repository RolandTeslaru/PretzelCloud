import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Realtime } from '@pretzel-cloud/shared/domain';
import { createRedisClient } from '@/utils/redis';

/**
 * The outbound side of the push channel.
 *
 * Redis rather than in-process fan-out: the API runs behind a load balancer, and
 * a client subscribed on one instance must still see an event published by
 * another. Every gateway holds a subscriber; this holds the one publisher.
 */
@Injectable()
export class RealtimeService implements OnModuleDestroy {

    private readonly redisPub = createRedisClient('realtime.service.pub');

    /** Fire and forget: a dropped event is not worth failing the operation that caused it. */
    publish<T extends Realtime.Event>(channel: Realtime.Channel, event: T): void {
        void this.redisPub.publish(channel, JSON.stringify(event));
    }

    onModuleDestroy() {
        this.redisPub.disconnect();
    }
}
