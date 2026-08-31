import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import type { IncomingMessage } from 'node:http';
import { SiloActivityService } from '@/services/Workspace/silo-activity.service';
import { HostCache } from './host.cache';

/** Which machine answers a Host header, and what a path is for. */
@Injectable()
export class Router {

    private readonly logger = new Logger(Router.name);

    constructor(
        @Inject(forwardRef(() => SiloActivityService))
        private readonly siloActivityService: SiloActivityService,

        private readonly hostCache: HostCache,
    ) {}

    /** Answered by the control plane even on a workspace hostname. */
    static readonly CONTROL_PLANE_PREFIXES = ['/api/session'];

    /** All the hooks hostname serves; the app hostname serves them too. */
    static readonly WEBHOOK_PREFIXES = ['/webhook', '/webhook-test'];

    /** Paths a workspace answers. Everything else is the editor. */

    /**
     * Starting an execution, as opposed to asking about one. `internal/run` is
     * a workflow calling another and is already paid for by the outer call;
     * `webhook-test` signals a run that is already going rather than making one.
     */
    static readonly METERED = [
        { method: 'POST', pattern: /^\/api\/execution\/(?!internal\/)[^/]+\/run(?:[?#]|$)/ },
        { method: null,   pattern: /^\/webhook\/[^/]+\/[^/?#]+/ },
    ] as const;

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

    private static matches(url: string | undefined, prefixes: readonly string[]): boolean {
        return prefixes.some((prefix) =>
            url === prefix || url?.startsWith(`${prefix}/`) || url?.startsWith(`${prefix}?`));
    }

    /** Lower-cased, port kept, parsed into the type the registrar writes. */
    private normalize(host: string | undefined): Fleet.Hostname.Host | null {
        if (!host)
            return null;

        const parsed = Fleet.Hostname.Host.Schema.safeParse(host.trim().toLowerCase());

        return parsed.success ? parsed.data : null;
    }

    /**
     * Reads the Host header and nothing else — never the path or cookies.
     * Resolving is also what records the workspace as used, so no caller has to remember to.
     */
    async resolve(req: IncomingMessage): Promise<Router.Resolution | null> {
        const host = this.normalize(req.headers.host);

        if (!host)
            return null;

        const resolution = await this.hostCache.get(host);

        if (!resolution)
            return null;

        this.siloActivityService.noteActivity(resolution.workspaceId);

        return resolution;
    }

    /** Canonical names are derived; pass a custom subdomain's old and new values. */
    invalidate(workspaceId: Workspace.Id, subdomains: (Workspace.Subdomain | null)[] = []): void {
        const labels = [Workspace.Subdomain.canonical(workspaceId), ...subdomains];

        for (const label of labels) {
            if (!label)
                continue;

            for (const { host } of Fleet.Hostname.Host.createAll(label))
                this.hostCache.invalidate(host);
        }

        this.logger.debug(`Invalidated routes for ${workspaceId}`);
    }

    invalidateAll(): void {
        this.hostCache.clear();
    }

    get stats() {
        return this.hostCache.stats;
    }
}

export namespace Router {

    export type Resolution = {
        workspaceId:    Workspace.Id;
        kind:           Fleet.Hostname.Kind;
        /** Stamped on forwarded traffic, so the silo can require it. */
        routerSecret:   string;
        /** Decides whether traffic may wake it. */
        lifecycleState: Workspace.Lifecycle.State;
        disabledReason: string | null;
        /** Null when the backend is not serving. */
        target:         URL | null;
    };
}
