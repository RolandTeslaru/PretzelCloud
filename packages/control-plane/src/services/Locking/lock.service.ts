import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Client } from 'pg';
import { requireEnv } from '@/db/table';
import { createRedisClient } from '@/utils/redis';
import { randomBytes } from 'node:crypto';

/**
 * Releases only a lock still held by this caller. A hold that outran its
 * deadline belongs to whoever took it next, and deleting the key blindly would
 * hand them a lock two callers think they have.
 */
const RELEASE_IF_MINE = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
    end

    return 0
`;

/**
 * One holder at a time for a named thing, across every control plane instance.
 * A Postgres advisory lock belongs to its connection, so a process that dies mid-hold
 * releases it — hence its own connection, never the pool.
 */
@Injectable()
export class LockService implements OnModuleDestroy {

    private readonly logger = new Logger(LockService.name);

    private readonly redis = createRedisClient('lock.service');

    /** Runs `fn` holding the lock, or returns null when another instance already holds it. */
    public async withDurableLock<T>(namespace: string, key: string, fn: () => Promise<T>): Promise<T | null> {
        const client = new Client({ connectionString: requireEnv('FLEET_DATABASE_URL') });

        await client.connect();

        try {
            // The namespace separates lock kinds, so a workspace's key cannot collide across them.
            const claimed = await client.query<{ locked: boolean }>(
                'select pg_try_advisory_lock(hashtext($1), hashtext($2)) as locked',
                [namespace, key],
            );

            if (!claimed.rows[0]?.locked) {
                this.logger.debug(`${namespace}/${key} is held elsewhere`);

                return null;
            }

            try {
                return await fn();
            }
            finally {
                await client.query('select pg_advisory_unlock(hashtext($1), hashtext($2))', [namespace, key]);
            }
        }
        finally {
            await client.end();
        }
    }




    /**
     * Whether a durable lock is held right now, without taking it.
     *
     * Racy on purpose: it answers for the moment it asked, and the caller may
     * act on a lock that is released a microsecond later. For telling someone
     * their request will be refused, not for deciding whether it is safe.
     */
    public async isDurablyLocked(namespace: string, key: string): Promise<boolean> {
        const client = new Client({ connectionString: requireEnv('FLEET_DATABASE_URL') });

        await client.connect();

        try {
            const held = await client.query(
                `select 1 from pg_locks
                 where locktype = 'advisory'
                   and classid  = hashtext($1)::oid
                   and objid    = hashtext($2)::oid
                   and granted`,
                [namespace, key],
            );

            return held.rowCount !== null && held.rowCount > 0;
        }
        finally {
            await client.end();
        }
    }




    /**
     * Held until `ttlMs` passes, whatever the work is doing. Cheaper than a
     * durable hold, and the deadline is a claim about how long the work takes —
     * overrun it and a second caller starts while the first is still going.
     */
    public async withEphemeralLock<T>(namespace: string, key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
        const name  = `lock:${namespace}:${key}`;
        const token = randomBytes(16).toString('hex');

        const claimed = await this.redis.set(name, token, 'PX', ttlMs, 'NX');

        if (!claimed) {
            this.logger.debug(`${namespace}/${key} is held elsewhere`);

            return null;
        }

        try {
            return await fn();
        }
        finally {
            await this.redis.eval(RELEASE_IF_MINE, 1, name, token);
        }
    }




    /**
     * Claims the key until `ttlMs` passes and never releases it early: for work
     * that runs at most once per window, whichever instance gets there first.
     */
    public async claimWindow(namespace: string, key: string, ttlMs: number): Promise<boolean> {
        const claimed = await this.redis.set(`lock:${namespace}:${key}`, 'claimed', 'PX', ttlMs, 'NX');

        return claimed === 'OK';
    }




    public onModuleDestroy() {
        this.redis.disconnect();
    }
}
