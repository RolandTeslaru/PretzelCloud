import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { Agent, createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import httpProxy from 'http-proxy';
import { TtlCache } from '@pretzel-cloud/shared/server/ttl-cache';
import { Workspace } from '@pretzel-cloud/shared/domain';
import { MachineDriver } from '@/services/Fleet/drivers/driver';
import { WorkspaceRouter, type Resolution } from './router.service';

const DEFAULT_PORT = 8080;

/** Every silo-bound request carries this, so silos can refuse direct dials. */
const TRUST_HEADER = 'x-trusted-proxy-token';

/**
 * Paths the workspace itself answers. Everything else is the editor, which is
 * the same build for every workspace and comes from outside the silo.
 */
const SILO_PREFIXES = ['/api', '/socket', '/webhook', '/health'];

const isSiloPath = (url: string | undefined) =>
    SILO_PREFIXES.some((prefix) => url === prefix || url?.startsWith(`${prefix}/`) || url?.startsWith(`${prefix}?`));

/**
 * Paths the control plane answers even on a workspace hostname. Checked before
 * the silo prefixes, which also match `/api`.
 */
const CONTROL_PLANE_PREFIXES = ['/api/session'];

const isControlPlanePath = (url: string | undefined) =>
    CONTROL_PLANE_PREFIXES.some((prefix) => url === prefix || url?.startsWith(`${prefix}/`) || url?.startsWith(`${prefix}?`));

/** How long a client is asked to wait while a machine boots. */
const RETRY_AFTER_S = 3;

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
        private readonly router: WorkspaceRouter,
        private readonly driver: MachineDriver,
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

        // The interface is served whether or not the machine behind it is
        // awake: a booting screen has to be able to render.
        if (resolution && isSiloPath(req.url) === false) {
            this.serveFrontend(req, res);
            return;
        }

        if (!resolution) {
            res.writeHead(404, { 'Content-Type': 'text/plain' }).end('No such workspace\n');
            return;
        }

        // Before the target check: minting a token must work while the machine
        // behind the hostname is asleep.
        if (isControlPlanePath(req.url)) {
            this.serveControlPlane(req, res);
            return;
        }

        if (!resolution.target) {
            await this.wake(resolution);

            res
                .writeHead(503, { 'Retry-After': String(RETRY_AFTER_S), 'Content-Type': 'text/plain' })
                .end('Workspace is starting\n');

            return;
        }

        this.proxy.web(
            req,
            res,
            {
                target:  resolution.target.toString(),
                headers: { [TRUST_HEADER]: resolution.routerSecret },
            },
            (error) => void this.onUpstreamError(error, resolution, res),
        );
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
    private async onUpstreamError(error: Error, resolution: Resolution, res: ServerResponse): Promise<void> {
        const unreachable = ['ECONNREFUSED', 'EHOSTUNREACH', 'ENOTFOUND', 'ECONNRESET']
            .includes((error as NodeJS.ErrnoException).code ?? '');

        this.router.invalidate(resolution.workspaceId);

        if (!unreachable) {
            this.logger.warn(`Upstream failed for ${resolution.workspaceId}: ${error.message}`);

            if (!res.headersSent)
                res.writeHead(502, { 'Content-Type': 'text/plain' }).end('Bad Gateway\n');

            return;
        }

        await this.wake(resolution);

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

        if (!resolution?.target) {
            if (resolution)
                await this.wake(resolution);

            socket.destroy();
            return;
        }

        this.proxy.ws(req, socket, head, {
            target:  resolution.target.toString(),
            headers: { [TRUST_HEADER]: resolution.routerSecret },
        });
    }

    /**
     * Starts a stopped machine, once. The route stays cached without a target
     * until the entry expires, so the resolution is dropped here — the next
     * request re-reads it and finds the address the driver can now report.
     */
    private async wake(resolution: Resolution): Promise<void> {
        const { workspaceId, machine } = resolution;

        if (this.waking.get(workspaceId))
            return;

        this.waking.set(workspaceId, true);

        try {
            this.logger.log(`Waking ${workspaceId}`);

            await this.driver.start(machine.externalId);

            this.router.invalidate(workspaceId);
        }
        catch (error) {
            this.logger.error(`Could not wake ${workspaceId}: ${error instanceof Error ? error.message : error}`);

            this.waking.delete(workspaceId);
        }
    }
}
