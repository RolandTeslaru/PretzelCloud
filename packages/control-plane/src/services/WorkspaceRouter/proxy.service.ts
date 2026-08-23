import { forwardRef, Inject, Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { Agent, createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import httpProxy from 'http-proxy';
import { TtlCache } from '@pretzel-cloud/shared/server/ttl-cache';
import { Workspace } from '@pretzel-cloud/shared/domain';
import { WorkspaceService } from '@/services/Workspace/workspace.service';
import { EntitlementService } from '@/services/Entitlement/entitlement.service';
import { requireEnv } from '@/db/table';
import { Router } from './router.service';

const DEFAULT_PORT = 8080;

/** Every silo-bound request carries this, so silos can refuse direct dials. */
const TRUST_HEADER = 'x-trusted-proxy-token';

/** How long a client is asked to wait while a machine boots. */
const RETRY_AFTER_S = 3;

// Past this the sender's own timeout fires anyway, so it gets the retry.
const WEBHOOK_WAIT_MS = 10_000;

// The session's first chunk. Presence is all this file reads.
const SESSION_COOKIE = 'pretzel.auth.token.0';

// One wake per workspace at a time; a booting machine draws a burst of retries.
const WAKE_LOCK_MS  = 15_000;
const WAKE_LOCK_MAX = 1_000;

// On the request, so it survives the hop into the proxy's response event.
const METERED = Symbol('pretzel.metered');

type Metered = IncomingMessage & { [METERED]?: Workspace.Id };

// A counted response past this is forwarded and counted without an id.
const USAGE_BODY_CAP = 64 * 1024;

// Without keep-alive every request leaves a socket in TIME_WAIT and a busy
// fleet exhausts the local port range.
const agent = new Agent({ keepAlive: true, maxSockets: 128, timeout: 30_000 });

/**
 * The data path: Host header to a machine, then bytes.
 *
 * Not a Nest controller — it has its own port and never parses a request body.
 * Reading the stream would leave nothing to forward and break webhook signatures.
 */
@Injectable()
export class ProxyService implements OnModuleInit, OnModuleDestroy {

    private readonly logger = new Logger(ProxyService.name);

    private readonly proxy = httpProxy.createProxyServer({
        // The workspace sees the name the client asked for.
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

        private readonly entitlements: EntitlementService,
    ) {}

    onModuleInit(): void {
        // Where upgrade failures land; a socket has no status code to send.
        this.proxy.on('error', (error, _req, socket) => {
            this.logger.warn(`Upstream failed: ${error.message}`);

            if (socket && 'destroy' in socket)
                socket.destroy();
        });

        // Returns immediately for anything not on a counted route.
        this.proxy.on('proxyRes', (proxyRes, req) => this.meter(proxyRes, req));

        const server = createServer((req, res) => void this.handle(req, res));

        // Upgrades arrive as their own event; the editor's live connection is one.
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

    /**
     * Whether anything about this request is worth spending a boot on. The
     * cookie is not verified — forging one only wakes a workspace its holder
     * still cannot enter, which the wake cooldown already bounds.
     */
    private static hasCredential(req: IncomingMessage): boolean {
        return Boolean(req.headers.authorization)
            || (req.headers.cookie ?? '').includes(`${SESSION_COOKIE}=`);
    }

    // does the host resolve?         → 404
    // is it a frontend asset?        → serve, awake or not
    // is it a control-plane path?    → the control plane answers it, no machine needed
    // is the workspace switched off? → 402 frozen / 503 stopped
    // is it out of executions?       → 402 over limit
    // is there a machine to reach?   → wake, or hold a webhook, or 503
    //                                → forward
    private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const resolution = await this.router.resolve(req);

        // The hooks hostname serves webhooks and nothing else.
        if (resolution?.kind === 'hooks' && !Router.isWebhookPath(req.url)) {
            res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found\n');
            return;
        }

        // Served whether or not the machine is awake, so a booting screen renders.
        // A signed-in visitor also starts it here, so the boot overlaps the
        // download rather than beginning at the first request that fails.
        if (resolution && Router.isSiloPath(req.url) === false) {
            // Accounts live in the portal, so an unidentified visitor is sent
            // there rather than handed a workspace's own sign-in page.
            if (!ProxyService.hasCredential(req)) {
                this.redirectToPortal(res);

                return;
            }

            if (Workspace.isWakeable(resolution.lifecycleState))
                this.wake(resolution);

            this.serveFrontend(req, res);
            return;
        }

        if (!resolution) {
            res.writeHead(404, { 'Content-Type': 'text/plain' }).end('No such workspace\n');
            return;
        }

        // Only the control plane can mint a workspace token, and doing so needs
        // no machine — so this is answered before asking whether one is up.
        if (Router.isControlPlanePath(req.url)) {
            this.serveControlPlane(req, res);
            return;
        }

        // Turned off rather than parked: nothing arriving may bring it back, and
        // which route it asked for makes no difference.
        if (!Workspace.acceptsTraffic(resolution.lifecycleState)) {
            this.refuseStoppedOrFrozen(res, resolution);

            return;
        }

        // Out of executions: refused from memory, before anything is forwarded.
        if (Router.isMeteredPath(req.method, req.url) && await this.entitlements.isLocked(resolution.workspaceId)) {
            this.refuseOverLimit(res);

            return;
        }

        if (!resolution.target) {
            // A webhook URL is itself the credential; anything else has to carry
            // one, or a stranger who knows the hostname could spend a boot.
            if (!Router.isWebhookPath(req.url) && !ProxyService.hasCredential(req)) {
                res.writeHead(401, { 'Content-Type': 'text/plain' }).end('Unauthorized\n');

                return;
            }

            // A webhook has nobody watching and no promised retry, so it waits.
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

    /**
     * Shaped like the workspace's own errors, so whatever reads one reads this:
     * the editor takes its message from `error.message` and would otherwise show
     * the bare status.
     */
    // No `Retry-After` on either: nothing is coming without a person.
    private refuseStoppedOrFrozen(res: ServerResponse, resolution: Router.Resolution): void {
        const frozen = resolution.lifecycleState === 'frozen';

        res.writeHead(frozen ? 402 : 503, { 'Content-Type': 'application/json' }).end(JSON.stringify({
            status: frozen ? 402 : 503,
            error: {
                code:    frozen ? 'WORKSPACE_FROZEN' : 'WORKSPACE_STOPPED',
                message: frozen
                    ? 'This workspace has been suspended.'
                    : 'This workspace has been turned off by its owner.',
                detail: frozen
                    ? resolution.frozenReason ?? 'Settle the account to bring it back.'
                    : 'Start it again from the dashboard.',
            },
        }));
    }

    private refuseOverLimit(res: ServerResponse): void {
        res.writeHead(402, { 'Content-Type': 'application/json' }).end(JSON.stringify({
            status: 402,
            error: {
                code:    'EXECUTION_LIMIT_REACHED',
                message: 'This workspace has used all the executions its plan includes.',
                detail:  'The allowance renews at the start of the next billing period. Changing plan raises it immediately.',
            },
        }));
    }

    private forward(req: IncomingMessage, res: ServerResponse, resolution: Router.Resolution, target: URL): void {
        // Read back on the response, the first word on whether anything was made.
        if (Router.isMeteredPath(req.method, req.url))
            (req as Metered)[METERED] = resolution.workspaceId;

        this.proxy.web(
            req,
            res,
            {
                target:  target.toString(),
                headers: { [TRUST_HEADER]: resolution.routerSecret },
            },
            (error) => void this.onUpstreamError(error, req, resolution, res),
        );
    }

    /** Where to reach it once it serves, or null if it missed the budget. */
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

        // The cached resolution predates the machine having an address.
        this.router.invalidate(workspaceId);

        return (await this.router.resolve(req))?.target ?? null;
    }

    /**
     * Counts an execution the workspace reported creating. Observed rather than
     * taken over: forwarded bytes stay untouched, so signatures still verify.
     */
    private meter(proxyRes: IncomingMessage, req: IncomingMessage): void {
        const workspaceId = (req as Metered)[METERED];

        if (!workspaceId)
            return;

        const status = proxyRes.statusCode ?? 0;

        // Only a success is an execution.
        if (status < 200 || status >= 300)
            return;

        const chunks: Buffer[] = [];
        let held = 0;
        let overflowed = false;

        proxyRes.on('data', (chunk: Buffer) => {
            held += chunk.length;

            if (held > USAGE_BODY_CAP) {
                overflowed = true;

                return;
            }

            chunks.push(chunk);
        });

        proxyRes.on('end', () => {
            const encoded = proxyRes.headers['content-encoding'];
            const readable = !overflowed && !encoded;
            const found = readable ? this.readExecution(Buffer.concat(chunks)) : null;

            if (!found)
                this.logger.error(`Counted a run for ${workspaceId} without an execution id (${overflowed ? 'body too large' : encoded ? `encoded ${encoded}` : 'unrecognised shape'})`);

            // Not awaited: a slow fleet database must not slow an execution.
            void this.entitlements.executions.recordAndLockIfOver(workspaceId, found?.executionId ?? null, found?.igniter ?? null)
                .catch((error: unknown) => this.logger.error(`Could not record usage for ${workspaceId}: ${error instanceof Error ? error.message : error}`));
        });
    }

    /** Both shapes a workspace answers a started execution with. */
    private readExecution(body: Buffer): { executionId: string; igniter: string | null } | null {
        try {
            const parsed = JSON.parse(body.toString('utf8')) as Record<string, unknown>;

            const execution = parsed.execution as Record<string, unknown> | undefined;

            if (execution && typeof execution.id === 'string')
                return {
                    executionId: execution.id,
                    igniter: typeof (execution.igniter as Record<string, unknown>)?.variant === 'string'
                        ? (execution.igniter as Record<string, unknown>).variant as string
                        : null,
                };

            if (typeof parsed.executionId === 'string')
                return { executionId: parsed.executionId, igniter: 'webhook' };

            return null;
        }
        catch {
            return null;
        }
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

    /** The editor, identical across workspaces: dev server here, built files later. */
    private redirectToPortal(res: ServerResponse): void {
        res.writeHead(302, { Location: requireEnv('PORTAL_URL'), 'Cache-Control': 'no-store' }).end();
    }

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
     * A refused connection usually means the machine stopped since it was
     * resolved, so the route is dropped and the client told to retry.
     */
    private async onUpstreamError(error: Error, req: IncomingMessage, resolution: Router.Resolution, res: ServerResponse): Promise<void> {
        const unreachable = ['ECONNREFUSED', 'EHOSTUNREACH', 'ENOTFOUND', 'ECONNRESET']
            .includes((error as NodeJS.ErrnoException).code ?? '');

        this.router.invalidate(resolution.workspaceId);

        if (!unreachable) {
            this.logger.warn(`Upstream failed for ${resolution.workspaceId}: ${error.message}`);

            if (!res.headersSent)
                res.writeHead(502, { 'Content-Type': 'text/plain' }).end('Bad Gateway\n');

            return;
        }

        if (Router.isWebhookPath(req.url) || ProxyService.hasCredential(req))
            this.wake(resolution);

        if (!res.headersSent)
            res
                .writeHead(503, { 'Retry-After': String(RETRY_AFTER_S), 'Content-Type': 'text/plain' })
                .end('Workspace is starting\n');
    }

    /** A socket has no status code, so anything but a clean forward closes it. */
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

    /** Starts the workspace once, through the workspace so the state is recorded. */
    private wake(resolution: Router.Resolution): void {
        const { workspaceId } = resolution;

        // A cooldown too: one that cannot come up must not be kicked repeatedly.
        if (this.waking.get(workspaceId))
            return;

        this.waking.set(workspaceId, true);

        this.logger.log(`Waking ${workspaceId}`);

        // Not awaited: a reclaimed workspace is rebuilt here, far longer than a
        // request should be held open.
        void this.workspaces.ensureStarted(workspaceId).catch((error) => {
            this.logger.error(`Could not wake ${workspaceId}: ${error instanceof Error ? error.message : error}`);

            this.waking.delete(workspaceId);
        });
    }
}
