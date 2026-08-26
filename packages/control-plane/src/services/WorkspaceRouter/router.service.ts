import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import type { IncomingMessage } from 'node:http';
import { TtlCache } from '@pretzel-cloud/shared/server/ttl-cache';
import { FleetDB } from '@/db/fleet';
import { PortalDB } from '@/db/portal';
import { HardwareService } from '@/services/Fleet/Hardware/hardware.service';
import { SiloActivityService } from '@/services/Workspace/silo-activity.service';

// A stale hit is caught by the forward failing; a stale miss 404s a live
// workspace, so misses expire fast.
const HIT_TTL_MS  = 30_000;
const MISS_TTL_MS = 2_000;

const HIT_CACHE_MAX  = 10_000;
const MISS_CACHE_MAX = 1_000;

/** Which machine answers a Host header, and what a path is for. */
@Injectable()
export class Router {

    private readonly logger = new Logger(Router.name);

    constructor(
        private readonly hardware: HardwareService,

        @Inject(forwardRef(() => SiloActivityService))
        private readonly activity: SiloActivityService,
    ) {}

    /** Answered by the control plane even on a workspace hostname. */
    static readonly CONTROL_PLANE_PREFIXES = ['/api/session'];

    /** All the hooks hostname serves; the app hostname serves them too. */
    static readonly WEBHOOK_PREFIXES = ['/webhook', '/webhook-test'];

    /**
     * Starting an execution, as opposed to asking about one. `internal/run` is
     * a workflow calling another and is already paid for by the outer call;
     * `webhook-test` signals a run that is already going rather than making one.
     */
    static readonly METERED = [
        { method: 'POST', pattern: /^\/api\/execution\/(?!internal\/)[^/]+\/run(?:[?#]|$)/ },
        { method: null,   pattern: /^\/webhook\/[^/]+\/[^/?#]+/ },
    ] as const;

    /** Whether a request, if it succeeds, is one execution against the plan. */
    static isMeteredPath(method: string | undefined, url: string | undefined): boolean {
        if (!url)
            return false;

        return Router.METERED.some((route) =>
            (route.method === null || route.method === method) && route.pattern.test(url));
    }

    static isControlPlanePath(url: string | undefined): boolean {
        return Router.matches(url, Router.CONTROL_PLANE_PREFIXES);
    }

    static isWebhookPath(url: string | undefined): boolean {
        return Router.matches(url, Router.WEBHOOK_PREFIXES);
    }

    /** A prefix matches the whole path, a segment under it, or it plus a query. */
    private static matches(url: string | undefined, prefixes: readonly string[]): boolean {
        return prefixes.some((prefix) =>
            url === prefix || url?.startsWith(`${prefix}/`) || url?.startsWith(`${prefix}?`));
    }

    // Two instances, because hits and misses want different lifetimes.
    private readonly hits   = new TtlCache<Fleet.Hostname.Host, Router.Resolution>(HIT_TTL_MS,  HIT_CACHE_MAX);
    private readonly misses = new TtlCache<Fleet.Hostname.Host, true>      (MISS_TTL_MS, MISS_CACHE_MAX);

    /** Lower-cased, port kept, parsed into the type the registrar writes. */
    private normalize(host: string | undefined): Fleet.Hostname.Host | null {
        if (!host)
            return null;

        const parsed = Fleet.Hostname.Host.Schema.safeParse(host.trim().toLowerCase());

        return parsed.success ? parsed.data : null;
    }

    /**
     * Reads the Host header and nothing else — never the path or cookies.
     * Resolving is also what records the workspace as used, so no caller has to
     * remember to.
     */
    async resolve(req: IncomingMessage): Promise<Router.Resolution | null> {
        const host = this.normalize(req.headers.host);

        if (!host)
            return null;

        const cached = this.hits.get(host);

        if (cached) {
            this.activity.noteActivity(cached.workspaceId);

            return cached;
        }

        if (this.misses.get(host))
            return null;

        const found = await this.lookup(host);

        if (!found) {
            this.misses.set(host, true);
            return null;
        }

        this.hits.set(host, found);

        this.activity.noteActivity(found.workspaceId);

        return found;
    }

    // One query, and joined on secrets rather than hardware: secrets outlive
    // reclaimed machines and go when the workspace does.
    private async lookup(host: Fleet.Hostname.Host): Promise<Router.Resolution | null> {
        const row = await FleetDB.asService('resolve host', (trx) =>
            trx
                .selectFrom('hostnames')
                .innerJoin('workspace_secrets', 'workspace_secrets.workspace_id', 'hostnames.workspace_id')
                .where('hostnames.host', '=', host)
                .select([
                    'hostnames.kind as hostname_kind',
                    'hostnames.workspace_id as hostname_workspace_id',
                    'workspace_secrets.router_secret as router_secret',
                ])
                .executeTakeFirst());

        if (!row)
            return null;

        const workspaceId = row.hostname_workspace_id;

        // Cached with the resolution, and dropped whenever the lifecycle moves.
        const desired = await PortalDB.asService('resolve lifecycle', (db) =>
            db.selectFrom('workspaces').select(['lifecycle_state', 'frozen_reason']).where('id', '=', workspaceId).executeTakeFirst());

        return {
            workspaceId,
            kind:         Fleet.Hostname.Kind.parse(row.hostname_kind),
            routerSecret: row.router_secret,
            lifecycleState: Workspace.LifecycleState.parse(desired?.lifecycle_state ?? 'running'),
            frozenReason:   desired?.frozen_reason ?? null,
            // Null when there is no machine, which a request rebuilds.
            target: await this.hardware.getBackendAddress(workspaceId),
        };
    }

    /** Canonical names are derived; pass a custom subdomain's old and new values. */
    invalidate(workspaceId: Workspace.Id, subdomains: (Workspace.Subdomain | null)[] = []): void {
        const labels = [Workspace.Subdomain.canonical(workspaceId), ...subdomains];

        for (const label of labels) {
            if (!label)
                continue;

            for (const { host } of Fleet.Hostname.Host.createAll(label)) {
                this.hits.delete(host);
                this.misses.delete(host);
            }
        }

        this.logger.debug(`Invalidated routes for ${workspaceId}`);
    }

    /** For a change too broad to name, such as a new domain. */
    invalidateAll(): void {
        this.hits.clear();
        this.misses.clear();

        this.logger.warn('Route cache cleared');
    }

    get stats() {
        return { hits: this.hits.size, misses: this.misses.size };
    }
}

// Merged with the class above: types only, so nothing is emitted.
export namespace Router {

    /** What one lookup produces: enough to forward, or to refuse. */
    export type Resolution = {
        workspaceId: Workspace.Id;
        kind:        Fleet.Hostname.Kind;
        /** Stamped on forwarded traffic, so the silo can require it. */
        routerSecret: string;
        /** What it should be doing, which decides whether traffic may wake it. */
        lifecycleState: Workspace.LifecycleState;
        /** The sentence shown when it is frozen. */
        frozenReason:   string | null;
        /** Null when the backend is not serving. */
        target:      URL | null;
    };
}
