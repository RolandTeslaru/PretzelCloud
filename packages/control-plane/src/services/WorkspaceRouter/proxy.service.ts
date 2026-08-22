import { forwardRef, Inject, Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { Agent, createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import httpProxy from 'http-proxy';
import { TtlCache } from '@pretzel-cloud/shared/server/ttl-cache';
import { Workspace } from '@pretzel-cloud/shared/domain';
import { WorkspaceService } from '@/services/Workspace/workspace.service';
import { Router } from './router.service';

const DEFAULT_PORT = 8080;

/** Every silo-bound request carries this, so silos can refuse direct dials. */
const TRUST_HEADER = 'x-trusted-proxy-token';

/** How long a client is asked to wait while a machine boots. */
const RETRY_AFTER_S = 3;

/**
 * How long a webhook is held while its workspace comes up. A resume is about a
 * second and a cold start a couple; past this the sender's own timeout is the
 * next thing to fire, so it is given the retry instead.
 */
const WEBHOOK_WAIT_MS = 10_000;

/**
 * One wake per workspace at a time. A booting machine draws a burst of retries,
 * and every one of them would otherwise issue its own start.
 */
const WAKE_LOCK_MS  = 15_000;
const WAKE_LOCK_MAX = 1_000;

/**
 * Reuse upstream sockets rather than opening one per request. Without this every
 * proxied request leaves a socket in TIME_WAIT, and a busy fleet exhausts the
 * local port range and starts dropping connections.
 */
const agent = new Agent({ keepAlive: true, maxSockets: 128, timeout: 30_000 });

/**
 * The data path. Resolves the Host header to a machine and forwards bytes to it.
 *
 * Deliberately not a Nest controller: this listens on its own port and never
 * parses a body. Reading the stream to build `req.body` would leave nothing to
 * forward, and would break webhook signatures, which are computed over the exact
 * bytes sent.
 */
@Injectable()
export class ProxyService implements OnModuleInit, OnModuleDestroy {

    private readonly logger = new Logger(ProxyService.name);

    private readonly proxy = httpProxy.createProxyServer({
        // Byte-for-byte: no rewriting of the Host header, so the workspace sees
        // the name the client asked for.
        changeOrigin: false,
        xfwd:         true,
        ws:           true,
        proxyTimeout: 30_000,
        timeout:      30_000,
        agent,
    });

    private readonly waking = new TtlCache<Workspace.Id, true>(WAKE_LOCK_MS, WAKE_LOCK_MAX);

    private server?: Server;

    constructor(
        private readonly router: Router,
        @Inject(forwardRef(() => WorkspaceService))
        private readonly workspaces: WorkspaceService,
    ) {}

    onModuleInit(): void {
        // Upgrades have no per-call callback, so their failures land here. A
        // socket has nowhere to put a status code; closing it is the whole
        // vocabulary.
        this.proxy.on('error', (error, _req, socket) => {
            this.logger.warn(`Upstream failed: ${error.message}`);

            if (socket && 'destroy' in socket)
                socket.destroy();
        });

        const server = createServer((req, res) => void this.handle(req, res));

        // Upgrades never reach the request handler — they arrive as their own
        // event, and the editor's live connection is one.
        server.on('upgrade', (req, socket, head) => void this.handleUpgrade(req, socket, head));

        const port = Number(process.env.FLEET_ROUTER_PORT ?? DEFAULT_PORT);

        server.listen(port, () => this.logger.log(`Router listening on http://localhost:${port}`));

        this.server = server;
    }

    async onModuleDestroy(): Promise<void> {
        await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve());

        this.proxy.close();
        agent.destroy();
    }

    private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const resolution = await this.router.resolve(req);

        // The hooks hostname is webhook delivery and nothing else — no editor,
        // no API, no token mint. Policy attaches to the hostname.
        if (resolution?.kind === 'hooks' && !Router.isWebhookPath(req.url)) {
            res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found\n');
            return;
        }

        // The interface is served whether or not the machine behind it is
        // awake: a booting screen has to be able to render.
        if (resolution && Router.isSiloPath(req.url) === false) {
            this.serveFrontend(req, res);
            return;
        }

        if (!resolution) {
            res.writeHead(404, { 'Content-Type': 'text/plain' }).end('No such workspace\n');
            return;
        }

        // Before the target check: minting a token must work while the machine
        // behind the hostname is asleep.
        if (Router.isControlPlanePath(req.url)) {
            this.serveControlPlane(req, res);
            return;
        }

        if (!resolution.target) {
            // A webhook has no client watching and no promise of a retry, so it
            // waits for the machine instead of being told to come back.
            const target = Router.isWebhookPath(req.url)
                ? await this.awaitTarget(req, resolution)
                : (this.wake(resolution), null);

            if (!target) {
                res.writeHead(503, { 'Retry-After': String(RETRY_AFTER_S), 'Content-Type': 'text/plain' })
                   .end('Workspace is starting\n');

                return;
            }

            // The sender may have given up while it booted.
            if (req.destroyed || res.writableEnded)
                return;

            this.forward(req, res, resolution, target);

            return;
        }

        this.forward(req, res, resolution, resolution.target);
    }

    private forward(req: IncomingMessage, res: ServerResponse, resolution: Router.Resolution, target: URL): void {
        this.proxy.web(
            req,
            res,
            {
                target:  target.toString(),
                headers: { [TRUST_HEADER]: resolution.routerSecret },
            },
            (error) => void this.onUpstreamError(error, resolution, res),
        );
    }

    /**
     * Waits for the workspace to serve, up to the webhook budget, and answers
     * with where to reach it. Null when it did not make it in time — the wake
     * carries on regardless, so a retry arrives to a machine already up.
     */
    private async awaitTarget(req: IncomingMessage, resolution: Router.Resolution): Promise<URL | null> {
        const { workspaceId } = resolution;

        const expired = new Promise<false>((resolve) => {
            setTimeout(() => resolve(false), WEBHOOK_WAIT_MS).unref();
        });

        const started = this.workspaces.ensureStarted(workspaceId)
            .then(() => true)
            .catch((error) => {
                this.logger.error(`Could not wake ${workspaceId}: ${error instanceof Error ? error.message : error}`);

                return false;
            });

        if (!await Promise.race([started, expired]))
            return null;

        // The resolution in hand was cached before the machine had an address.
        this.router.invalidate(workspaceId);

        return (await this.router.resolve(req))?.target ?? null;
    }

    /** This same process, on its HTTP port. */
    private serveControlPlane(req: IncomingMessage, res: ServerResponse): void {
        const origin = `http://127.0.0.1:${process.env.PORT ?? 4000}`;

        this.proxy.web(req, res, { target: origin }, (error) => {
            this.logger.warn(`Control plane forward failed: ${error.message}`);

            if (!res.headersSent)
                res.writeHead(502, { 'Content-Type': 'text/plain' }).end('Bad Gateway\n');
        });
    }

    /**
     * The editor, which is identical across workspaces. In development this is
     * the dev server, so the same hostname carries hot reload; in production it
     * is a directory of built files, and unknown paths fall back to index.html
     * for the router running inside the page.
     */
    private serveFrontend(req: IncomingMessage, res: ServerResponse): void {
        const origin = process.env.FRONTEND_ORIGIN;

        if (origin) {
            this.proxy.web(req, res, { target: origin }, (error) => {
                this.logger.warn(`Frontend origin failed: ${error.message}`);

                if (!res.headersSent)
                    res.writeHead(502, { 'Content-Type': 'text/plain' }).end('Editor unavailable\n');
            });

            return;
        }

        res.writeHead(501, { 'Content-Type': 'text/plain' })
            .end('No editor configured. Set FRONTEND_ORIGIN.\n');
    }

    /**
     * A cached route outlives the machine it points at, so a refused connection
     * usually means the machine stopped since it was resolved — not a failure
     * worth reporting as one. The entry is dropped and the request answered the
     * way a stopped machine would have been, so the client's retry finds it
     * waking rather than broken.
     */
    private async onUpstreamError(error: Error, resolution: Router.Resolution, res: ServerResponse): Promise<void> {
        const unreachable = ['ECONNREFUSED', 'EHOSTUNREACH', 'ENOTFOUND', 'ECONNRESET']
            .includes((error as NodeJS.ErrnoException).code ?? '');

        this.router.invalidate(resolution.workspaceId);

        if (!unreachable) {
            this.logger.warn(`Upstream failed for ${resolution.workspaceId}: ${error.message}`);

            if (!res.headersSent)
                res.writeHead(502, { 'Content-Type': 'text/plain' }).end('Bad Gateway\n');

            return;
        }

        this.wake(resolution);

        if (!res.headersSent)
            res
                .writeHead(503, { 'Retry-After': String(RETRY_AFTER_S), 'Content-Type': 'text/plain' })
                .end('Workspace is starting\n');
    }

    /**
     * A socket has nowhere to put a status code, so anything other than a
     * successful forward closes it. A client that reconnects will meet the same
     * 404 or 503 on its next plain request.
     */
    private async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
        const resolution = await this.router.resolve(req);

        // Webhooks never upgrade.
        if (resolution?.kind === 'hooks') {
            socket.destroy();
            return;
        }

        if (!resolution?.target) {
            if (resolution)
                this.wake(resolution);

            socket.destroy();
            return;
        }

        this.proxy.ws(req, socket, head, {
            target:  resolution.target.toString(),
            headers: { [TRUST_HEADER]: resolution.routerSecret },
        });
    }

    /**
     * Starts the workspace, once. Routed through the workspace rather than its
     * hardware so a wake is bookkept like any other transition: the state is
     * written and subscribers hear about it, instead of a machine quietly
     * coming up behind a row that still says stopped.
     */
    private wake(resolution: Router.Resolution): void {
        const { workspaceId } = resolution;

        // A cooldown as well as a guard: a workspace that cannot come up must
        // not be kicked again by every request that arrives meanwhile.
        if (this.waking.get(workspaceId))
            return;

        this.waking.set(workspaceId, true);

        this.logger.log(`Waking ${workspaceId}`);

        // Not awaited: the client is told to retry, and the wake carries on
        // behind it. Machines reclaimed while unused are rebuilt here, which is
        // far longer than a request should be held open for.
        void this.workspaces.ensureStarted(workspaceId).catch((error) => {
            this.logger.error(`Could not wake ${workspaceId}: ${error instanceof Error ? error.message : error}`);

            this.waking.delete(workspaceId);
        });
    }
}
