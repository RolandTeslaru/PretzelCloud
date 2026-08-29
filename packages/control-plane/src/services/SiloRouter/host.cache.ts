import { Injectable, Logger } from '@nestjs/common';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { TtlCache } from '@pretzel-cloud/shared/server/ttl-cache';
import { FleetDB } from '@/db/fleet';
import { PortalDB } from '@/db/portal';
import { HardwareService } from '@/services/Fleet/Hardware/hardware.service';
import { GlobalCaching, GlobalCachingService } from '@/services/Caching/caching.service';
import type { Router } from './router.service';

// A stale hit is caught by the forward failing; a stale miss 404s a live
// workspace, so misses expire fast.
const HIT_TTL_MS  = 30_000;
const MISS_TTL_MS = 2_000;

const HIT_CACHE_MAX  = 10_000;
const MISS_CACHE_MAX = 1_000;

/**
 * Hits are shared so an instance that never resolved a host still hears it
 * dropped. The value stays local: a resolution carries the workspace's router
 * secret, which has no business on the bus.
 */
const HITS_CHANNEL = GlobalCaching.Channel.parse('cache:router-hits');

/**
 * What answers a hostname, and the memory of having asked.
 *
 * Misses are not shared. They last two seconds, which is shorter than any
 * invalidation would take to arrive, and a hostname that resolves nowhere on
 * one instance resolves nowhere on the others.
 */
@Injectable()
export class HostCache {

    private readonly logger = new Logger(HostCache.name);

    private readonly misses = new TtlCache<Fleet.Hostname.Host, true>(MISS_TTL_MS, MISS_CACHE_MAX);

    constructor(
        private readonly hardwareService:      HardwareService,
        private readonly globalCachingService: GlobalCachingService,
    ) {
        this.globalCachingService.create(HITS_CHANNEL, HIT_TTL_MS, HIT_CACHE_MAX, false);
    }




    /** Cached, or looked up and cached. Null is remembered too, briefly. */
    public async get(host: Fleet.Hostname.Host): Promise<Router.Resolution | null> {
        const cached = this.globalCachingService.get(HITS_CHANNEL, host) as Router.Resolution | undefined;

        if (cached)
            return cached;

        if (this.misses.get(host))
            return null;

        const found = await this.lookup(host);

        if (!found) {
            this.misses.set(host, true);

            return null;
        }

        this.globalCachingService.set(HITS_CHANNEL, host, found);

        return found;
    }




    public invalidate(host: Fleet.Hostname.Host): void {
        this.globalCachingService.delete(HITS_CHANNEL, host);
        this.misses.delete(host);
    }




    /** For a change too broad to name a host for, such as a new domain. */
    public clear(): void {
        this.globalCachingService.clear(HITS_CHANNEL);
        this.misses.clear();

        this.logger.warn('Route cache cleared');
    }




    public get stats() {
        return { hits: this.globalCachingService.size(HITS_CHANNEL), misses: this.misses.size };
    }




    // One query, and joined on secrets rather than hardware: secrets outlive
    // reclaimed machines and go when the workspace does.
    private async lookup(host: Fleet.Hostname.Host): Promise<Router.Resolution | null> {
        const row = await FleetDB.asService('resolve host', (trx) =>
            trx
                .selectFrom('hostnames')
                .innerJoin('silo_secrets', 'silo_secrets.workspace_id', 'hostnames.workspace_id')
                .where('hostnames.host', '=', host)
                .select([
                    'hostnames.kind as hostname_kind',
                    'hostnames.workspace_id as hostname_workspace_id',
                    'silo_secrets.router_secret as router_secret',
                ])
                .executeTakeFirst());

        if (!row)
            return null;

        const workspaceId = row.hostname_workspace_id;

        // Cached with the resolution, and dropped whenever the lifecycle moves.
        const desired = await PortalDB.asService('resolve lifecycle', (db) =>
            db.selectFrom('workspaces').select(['lifecycle_state', 'disabled_reason']).where('id', '=', workspaceId).executeTakeFirst());

        return {
            workspaceId,
            kind:         Fleet.Hostname.Kind.parse(row.hostname_kind),
            routerSecret: row.router_secret,
            lifecycleState: Workspace.Lifecycle.State.parse(desired?.lifecycle_state ?? 'running'),
            disabledReason:   desired?.disabled_reason ?? null,
            // Null when there is no machine, which a request rebuilds.
            target: await this.hardwareService.getBackendAddress(workspaceId),
        };
    }
}
