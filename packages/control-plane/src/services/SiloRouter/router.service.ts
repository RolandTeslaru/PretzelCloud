import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import type { IncomingMessage } from 'node:http';
import { SiloActivityService } from '@/services/Workspace/silo-activity.service';
import { HostBelongingCache } from './cache/host-belonging.cache';
import { WorkspaceLifecycleCache } from './cache/workspace-lifecycle.cache';
import { TargetCache } from './cache/target.cache';

const matchesPrefix = (url: string | undefined, prefixes: readonly string[]): boolean =>
    prefixes.some((prefix) =>
        url === prefix || url?.startsWith(`${prefix}/`) || url?.startsWith(`${prefix}?`));

// Host header to a machine; path to a kind.
@Injectable()
export class Router {

    private readonly logger = new Logger(Router.name);

    public constructor(
        @Inject(forwardRef(() => SiloActivityService))
        private readonly siloActivityService: SiloActivityService,

        private readonly hostBelongingCache:      HostBelongingCache,
        private readonly workspaceLifecycleCache: WorkspaceLifecycleCache,
        private readonly targetCache:             TargetCache,
    ) {}




    // Each drops, then refills now rather than on the next request.
    public invalidateLifecycle(workspaceId: Workspace.Id): void {
        this.workspaceLifecycleCache.invalidate(workspaceId);

        this.workspaceLifecycleCache.get(workspaceId)
            .catch((error) => this.logRefillFailure(workspaceId, error));
    }




    // For a caller that already knows it, so nothing is looked up again.
    public setAddress(workspaceId: Workspace.Id, address: URL | null): void {
        this.targetCache.set(workspaceId, address);
    }




    // Resolves to the fresh address. Void it to not wait.
    public invalidateAddress(workspaceId: Workspace.Id): Promise<URL | null> {
        this.targetCache.invalidate(workspaceId);

        return this.targetCache.get(workspaceId)
            .catch((error) => {
                this.logRefillFailure(workspaceId, error);

                return null;
            });
    }




    // Pass a custom subdomain's old and new values.
    public invalidate(workspaceId: Workspace.Id, subdomains: (Workspace.Subdomain | null)[] = []): void {
        const hosts = Router.getHostnames(workspaceId, subdomains);

        for (const host of hosts)
            this.hostBelongingCache.invalidate(host);

        this.workspaceLifecycleCache.invalidate(workspaceId);
        this.targetCache.invalidate(workspaceId);

        this.warm(workspaceId, subdomains);
    }




    // Fills whatever is not already cached. Does not drop stale entries; see `invalidate`.
    public warm(workspaceId: Workspace.Id, subdomains: (Workspace.Subdomain | null)[] = []): void {
        const hosts = Router.getHostnames(workspaceId, subdomains);

        const lookups: Promise<unknown>[] = [];

        for (const host of hosts)
            lookups.push(this.hostBelongingCache.get(host));

        lookups.push(this.workspaceLifecycleCache.get(workspaceId));
        lookups.push(this.targetCache.get(workspaceId));

        Promise.all(lookups)
            .catch((error) => this.logRefillFailure(workspaceId, error));
    }




    // Every hostname a workspace answers at: canonical plus any custom labels, one per kind.
    private static getHostnames(workspaceId: Workspace.Id, subdomains: (Workspace.Subdomain | null)[]): Fleet.Hostname.Host[] {
        const labels = [Workspace.Subdomain.canonical(workspaceId), ...subdomains];

        const hostnames: Fleet.Hostname.Host[] = [];

        for (const label of labels) {
            if (!label)
                continue;

            for (const { host } of Fleet.Hostname.Host.createAll(label))
                hostnames.push(host);
        }

        return hostnames;
    }




    private logRefillFailure(workspaceId: Workspace.Id, error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);

        this.logger.warn(`Could not refill ${workspaceId}: ${message}`);
    }




    public clear(): void {
        this.hostBelongingCache.clear();
        this.workspaceLifecycleCache.clear();
        this.targetCache.clear();
    }

    public get stats() {
        return { ...this.hostBelongingCache.stats, lifecycles: this.workspaceLifecycleCache.size, targets: this.targetCache.size };
    }

    public static readonly CONTROL_PLANE_PREFIXES = ['/api/session'];

    public static readonly WEBHOOK_PREFIXES = ['/webhook', '/webhook-test'];

    // Paths that start an execution. `internal/run` is paid for by the outer call.
    public static readonly METERED = [
        { method: 'POST', pattern: /^\/api\/execution\/(?!internal\/)[^/]+\/run(?:[?#]|$)/ },
        { method: null,   pattern: /^\/webhook\/[^/]+\/[^/?#]+/ },
    ] as const;

    



    public static isMeteredPath(method: string | undefined, url: string | undefined): boolean {
        if (!url)
            return false;

        return Router.METERED.some((route) =>
            (route.method === null || route.method === method) && route.pattern.test(url));
    }





    public static isControlPlanePath(url: string | undefined): boolean {
        return matchesPrefix(url, Router.CONTROL_PLANE_PREFIXES);
    }





    // Unset in compose, where nothing shares a port.
    public static isControlPlaneHost(req: IncomingMessage): boolean {
        const configured = process.env.CONTROL_PLANE_HOST;

        if (!configured)
            return false;

        const host = (req.headers.host ?? '').trim().toLowerCase();

        return host === configured.trim().toLowerCase();
    }




    
    public static isWebhookPath(url: string | undefined): boolean {
        return matchesPrefix(url, Router.WEBHOOK_PREFIXES);
    }





    // Lower-cased, port kept.
    private static parseHostname(req: IncomingMessage): Fleet.Hostname.Host | null {
        const host = req.headers.host;

        if (!host)
            return null;

        const parsed = Fleet.Hostname.Host.Schema.safeParse(host.trim().toLowerCase());

        return parsed.success ? parsed.data : null;
    }





    public async getHostBelonging(req: IncomingMessage): Promise<HostBelongingCache.Entry | null> {
        const hostname = Router.parseHostname(req);

        if (!hostname)
            return null;

        return this.hostBelongingCache.get(hostname);
    }





    // Host header only. Also records activity.
    public async getTicket(req: IncomingMessage): Promise<Router.SiloTicket | null> {
        const entry = await this.getHostBelonging(req);

        if (!entry)
            return null;

        const lifecycle = await this.workspaceLifecycleCache.get(entry.workspaceId);

        // Asleep has nothing to look up; the wake sets the address itself.
        let backendAddress: URL | null = null;

        if (lifecycle.lifecycleState === 'running')
            backendAddress = await this.targetCache.get(entry.workspaceId);

        this.siloActivityService.noteActivity(entry.workspaceId);

        return { ...entry, ...lifecycle, backendAddress };
    }
}





export namespace Router {

    export type SiloTicket = {
        workspaceId:    Workspace.Id;
        kind:           Fleet.Hostname.Kind;
        routerSecret:   string;
        lifecycleState: Workspace.Lifecycle.State;
        disabledReason: string | null;
        // Null when not serving.
        backendAddress: URL | null;
    };
}
