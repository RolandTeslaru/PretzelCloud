import { Injectable, Logger } from '@nestjs/common';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import type { IncomingMessage } from 'node:http';
import { TtlCache } from '@pretzel-cloud/shared/server/ttl-cache';
import { FleetDB } from '@/db/fleet';
import { MachineDriver } from '@/services/Fleet/drivers/driver';

/**
 * Hits are cheap to be wrong about for a moment — a machine that stopped is
 * caught by the forward failing. Misses are not: a workspace provisioned a
 * second ago would keep answering 404 for the whole window, so they expire
 * fast enough that a fresh workspace is reachable almost immediately.
 */
const HIT_TTL_MS  = 30_000;
const MISS_TTL_MS = 2_000;

const HIT_CACHE_MAX  = 10_000;
const MISS_CACHE_MAX = 1_000;

/** What one lookup produces: everything needed to forward, or to refuse. */
export type Resolution = {
    workspaceId: Workspace.Id;
    kind:        Fleet.Hostname.Kind;
    machine:     Fleet.Machine;
    /** Stamped on forwarded traffic, so the silo can require it. */
    routerSecret: string;
    /** Where to forward. Null when the machine is not currently serving. */
    target:      URL | null;
};

/**
 * Resolves an inbound Host header to the machine that should answer it.
 *
 * Every request passes through here, so the registry is read from memory and
 * only refreshed on a miss. Nothing here parses a path or a body: the answer is
 * which machine, or none.
 */
@Injectable()
export class WorkspaceRouter {

    private readonly logger = new Logger(WorkspaceRouter.name);

    constructor(private readonly driver: MachineDriver) {}

    // Separate instances rather than one holding nullable values: the two want
    // very different lifetimes, and the class takes a single TTL.
    private readonly hits   = new TtlCache<Fleet.Hostname.Host, Resolution>(HIT_TTL_MS,  HIT_CACHE_MAX);
    private readonly misses = new TtlCache<Fleet.Hostname.Host, true>      (MISS_TTL_MS, MISS_CACHE_MAX);

    /**
     * Host headers arrive in whatever case the client sent, and DNS names are
     * case-insensitive; the registry stores them lower case. The port stays —
     * it is part of the name whenever it is not the scheme's default, and
     * lookups match on equality.
     *
     * Parsed into the same branded type the registrar writes, so anything the
     * schema rejects cannot be in the registry and is refused before the
     * caches or the database see it.
     */
    private normalize(host: string | undefined): Fleet.Hostname.Host | null {
        if (!host)
            return null;

        const parsed = Fleet.Hostname.Host.Schema.safeParse(host.trim().toLowerCase());

        return parsed.success ? parsed.data : null;
    }

    /**
     * Resolution reads the Host header and nothing else about the request —
     * which workspace a request belongs to must never depend on its path,
     * cookies, or method.
     */
    async resolve(req: IncomingMessage): Promise<Resolution | null> {
        const host = this.normalize(req.headers.host);

        if (!host)
            return null;

        const cached = this.hits.get(host);

        if (cached)
            return cached;

        if (this.misses.get(host))
            return null;

        const found = await this.lookup(host);

        if (!found) {
            this.misses.set(host, true);
            return null;
        }

        this.hits.set(host, found);

        return found;
    }

    /**
     * One query, because two would let a workspace be torn down between them and
     * return a hostname pointing at a machine that no longer exists.
     */
    private async lookup(host: Fleet.Hostname.Host): Promise<Resolution | null> {
        const row = await FleetDB.asService('resolve host', (trx) =>
            trx
                .selectFrom('hostnames')
                .innerJoin('machines', 'machines.workspace_id', 'hostnames.workspace_id')
                .innerJoin('workspace_secrets', 'workspace_secrets.workspace_id', 'hostnames.workspace_id')
                .where('hostnames.host', '=', host)
                .where('machines.state', '!=', 'destroyed')
                .selectAll('machines')
                .select([
                    'hostnames.kind as hostname_kind',
                    'hostnames.workspace_id as hostname_workspace_id',
                    'workspace_secrets.router_secret as router_secret',
                ])
                .executeTakeFirst());

        if (!row)
            return null;

        const { hostname_kind, hostname_workspace_id, router_secret, ...columns } = row;

        const machine = FleetDB.Machine.toDomain(FleetDB.Machine.Row.parse(columns));

        return {
            workspaceId: hostname_workspace_id,
            kind:        Fleet.Hostname.Kind.parse(hostname_kind),
            machine,
            routerSecret: router_secret,
            // The driver decides how a machine is reached — a published port
            // here, internal DNS elsewhere.
            target: await this.driver.address(machine.externalId),
        };
    }

    /**
     * Called when a workspace's machines or hostnames change. The canonical
     * names are derived, so they need no lookup; a custom subdomain is only
     * known to the caller that changed it, and both its old and new values have
     * to be passed for the entries to go.
     */
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

    /** Drops everything. For a change too broad to name, such as a domain change. */
    invalidateAll(): void {
        this.hits.clear();
        this.misses.clear();

        this.logger.warn('Route cache cleared');
    }

    get stats() {
        return { hits: this.hits.size, misses: this.misses.size };
    }
}
