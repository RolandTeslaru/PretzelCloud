import { Injectable, Logger } from '@nestjs/common';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { TtlCache } from '@pretzel-cloud/shared/server/ttl-cache';
import { FleetDB } from '@/db/fleet';
import { GlobalCaching, GlobalCachingService } from '@/services/Caching/caching.service';

// Changes only at provisioning. Finite as a backstop for a dropped invalidation.
const HIT_TTL_MS  = 24 * 60 * 60_000;
// A stale miss 404s a live workspace, so misses expire fast.
const MISS_TTL_MS = 2_000;

const HIT_CACHE_MAX  = 10_000;
const MISS_CACHE_MAX = 1_000;

// Not replicated: the value carries the router secret.
const CHANNEL = GlobalCaching.Channel.parse('cache:host-belonging');

// Which workspace a host belongs to.
@Injectable()
export class HostBelongingCache {

    private readonly logger = new Logger(HostBelongingCache.name);

    private readonly misses = new TtlCache<Fleet.Hostname.Host, true>(MISS_TTL_MS, MISS_CACHE_MAX);

    constructor(private readonly globalCache: GlobalCachingService) {
        this.globalCache.create(CHANNEL, HIT_TTL_MS, HIT_CACHE_MAX, false);
    }




    public async get(host: Fleet.Hostname.Host): Promise<HostBelongingCache.Entry | null> {
        const cached = this.globalCache.get(CHANNEL, host) as HostBelongingCache.Entry | undefined;

        if (cached)
            return cached;

        if (this.misses.get(host))
            return null;

        const found = await this.lookup(host);

        if (!found) {
            this.misses.set(host, true);

            return null;
        }

        this.globalCache.set(CHANNEL, host, found);

        return found;
    }




    public invalidate(host: Fleet.Hostname.Host): void {
        this.globalCache.delete(CHANNEL, host);
        this.misses.delete(host);
    }




    public clear(): void {
        this.globalCache.clear(CHANNEL);
        this.misses.clear();

        this.logger.warn('Host cache cleared');
    }




    public get stats() {
        return { hosts: this.globalCache.size(CHANNEL), misses: this.misses.size };
    }




    // Joined on secrets, not hardware: secrets outlive reclaimed machines.
    private async lookup(host: Fleet.Hostname.Host): Promise<HostBelongingCache.Entry | null> {
        const row = await FleetDB.asService('resolve host', (trx) =>
            trx
                .selectFrom('hostnames')
                .innerJoin('silo_secrets', 'silo_secrets.workspace_id', 'hostnames.workspace_id')
                .where('hostnames.host', '=', host)
                .select([
                    'hostnames.kind as kind',
                    'hostnames.workspace_id as workspace_id',
                    'silo_secrets.router_secret as router_secret',
                ])
                .executeTakeFirst());

        if (!row)
            return null;

        return {
            workspaceId:  row.workspace_id,
            kind:         row.kind,
            routerSecret: row.router_secret,
        };
    }
}

export namespace HostBelongingCache {

    export type Entry = {
        workspaceId:  Workspace.Id;
        kind:         Fleet.Hostname.Kind;
        routerSecret: string;
    };
}
