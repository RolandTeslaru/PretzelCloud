import { Logger } from '@nestjs/common';
import Redis, { type RedisOptions } from 'ioredis';

const logger = new Logger('Redis');

const host = () => process.env.CONTROL_REDIS_HOST ?? 'localhost';
const port = () => Number(process.env.CONTROL_REDIS_PORT ?? 6379);

/** ioredis prints the full stack for an error nobody listens to, so every client gets a handler. */
export function createRedisClient(name: string, options: RedisOptions = {}): Redis {
    const client = new Redis({ host: host(), port: port(), ...options });

    client.on('error', (error: Error) => logger.warn(`${name}: ${error.message}`));

    return client;
}

/** The ready check sends INFO, which a connection in subscriber mode may refuse. */
export function createRedisSubscriber(name: string): Redis {
    return createRedisClient(name, { enableReadyCheck: false });
}
