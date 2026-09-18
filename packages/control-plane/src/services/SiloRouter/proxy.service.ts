import { forwardRef, Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Agent, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import httpProxy from 'http-proxy';
import { Workspace } from '@pretzel-cloud/shared/domain';
import { WorkspaceService } from '@/services/Workspace/workspace.service';
import { EntitlementService } from '@/services/Entitlement/entitlement.service';
import { HardwareService } from '@/services/Fleet/Hardware/hardware.service';
import { requireEnv } from '@/db/table';
import { Router } from './router.service';
import { GlobalCaching, GlobalCachingService } from '@/services/Caching/caching.service';

// Silos refuse requests without it.
const TRUST_HEADER = 'x-trusted-proxy-token';

const RETRY_AFTER_S = 3;

// How often the starting page asks whether the machine is up.
const STARTING_PAGE_POLL_MS = 500;

// Held before answering "starting": a suspended machine resumes well inside this.
const REQUEST_WAIT_MS = 2_000;

// Self-refreshing page shown while a machine boots.
const STARTING_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Starting</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light dark }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         font: 500 14px/1.5 ui-sans-serif, system-ui, sans-serif }
  p { opacity: .6 }
</style>
</head>
<body>
<p>Starting this workspace…</p>
<script>
  const POLL_MS = ${STARTING_PAGE_POLL_MS};

  async function poll() {
    try {
      const response = await fetch('/health', { cache: 'no-store' });

      if (response.ok) {
        location.reload();

        return;
      }
    }
    catch {}

    setTimeout(poll, POLL_MS);
  }

  poll();
</script>
</body>
</html>
`;

const WEBHOOK_WAIT_MS = 10_000;

// Past this the sender's own timeout fires anyway.
// Null when the promise outlives the timer.
async function withinTimer<T>(promise: Promise<T>, timerMs: number): Promise<T | null> {
    let timer: NodeJS.Timeout | undefined;

    const expired = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timerMs);

        timer.unref();
    });

    try {
        return await Promise.race([promise, expired]);
    }
    finally {
        clearTimeout(timer);
    }
}

// Only checked for presence.
const SESSION_COOKIE = 'pretzel.auth.token.0';

// A workspace that failed to come up is not kicked again for this long.
const WAKE_COOLDOWN_MS  = 15_000;
const WAKE_COOLDOWN_MAX = 1_000;

// Best effort across instances; the bus is not a lock.
const WAKE_COOLDOWN_CHANNEL = GlobalCaching.Channel.parse('cache:wake-cooldown');

// Stamped on the request; read back on the response.
const METERED = Symbol('pretzel.metered');

type Metered = IncomingMessage & { [METERED]?: Workspace.Id };

// What the router spent on a request, in ms. Sent back as `Server-Timing`, which DevTools shows per request.
const TIMINGS = Symbol('pretzel.timings');

type Timings = { ticket?: number; wake?: number; forwardedAt?: number };

type Timed = IncomingMessage & { [TIMINGS]?: Timings };

// Larger bodies are counted without an id.
const USAGE_BODY_CAP = 64 * 1024;

// Keep-alive, or a busy fleet runs out of ports.
const agent = new Agent({ keepAlive: true, maxSockets: 128, timeout: 30_000 });

// Host header to a machine. Never reads the body.
@Injectable()
export class ProxyService implements OnModuleDestroy {

    private readonly logger = new Logger(ProxyService.name);

    // One wake per workspace per instance; every poll joins the one in flight.
    private readonly waking = new Map<Workspace.Id, Promise<URL | null>>();

    private readonly proxy = httpProxy.createProxyServer({
        changeOrigin: false,
        xfwd:         true,
        ws:           true,
        proxyTimeout: 30_000,
        timeout:      30_000,
        agent,
    });


    constructor(
        private readonly router: Router,
        @Inject(forwardRef(() => WorkspaceService))
        private readonly workspaceService: WorkspaceService,

        private readonly entitlementService: EntitlementService,

        private readonly hardwareService: HardwareService,

        private readonly globalCachingService: GlobalCachingService,
    ) {
        this.globalCachingService.create(WAKE_COOLDOWN_CHANNEL, WAKE_COOLDOWN_MS, WAKE_COOLDOWN_MAX);

        // Upgrade failures land here; a socket has no status code.
        this.proxy.on('error', (error, _req, socket) => {
            this.logger.warn(`Upstream failed: ${error.message}`);

            if (socket && 'destroy' in socket)
                socket.destroy();
        });

        this.proxy.on('proxyRes', (proxyRes, req, res) => {
            this.stampServerTiming(req, res);

            this.handleMeteredPath(proxyRes, req);
        });
    }



    public onModuleDestroy(): void {
        this.proxy.close();
        agent.destroy();
    }

    private static hasCredential(req: IncomingMessage): boolean {
        return Boolean(req.headers.authorization)
            || (req.headers.cookie ?? '').includes(`${SESSION_COOKIE}=`);
    }

    private static isPageRequest(req: IncomingMessage): boolean {
        if (req.method !== 'GET' && req.method !== 'HEAD')
            return false;

        // `document` only on a navigation.
        if (req.headers['sec-fetch-dest'])
            return req.headers['sec-fetch-dest'] === 'document';

        return (req.headers.accept ?? '').includes('text/html');
    }


    public async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const isControlPlaneHost = Router.isControlPlaneHost(req);
        const isControlPlanePath = Router.isControlPlanePath(req.url);
        const isWebhookPath      = Router.isWebhookPath(req.url);
        const isMeteredPath      = Router.isMeteredPath(req.method, req.url);
        const isPageRequest      = ProxyService.isPageRequest(req);
        const hasCredential      = ProxyService.hasCredential(req);

        if (isControlPlaneHost) {
            this.serveControlPlane(req, res);

            return;
        }

        const timings: Timings = {};

        (req as Timed)[TIMINGS] = timings;

        const ticketStartedAt = Date.now();

        const siloTicket = await this.router.getTicket(req);

        timings.ticket = Date.now() - ticketStartedAt;

        if (!siloTicket) {
            if (req.url === '/health') {
                res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok\n');

                return;
            }

            res.writeHead(404, { 'Content-Type': 'text/plain' }).end('No such workspace\n');

            return;
        }

        // Hooks hostname serves webhooks only.
        if (siloTicket.kind === 'hooks' && !isWebhookPath) {
            res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found\n');

            return;
        }

        // Token minting needs no machine.
        if (isControlPlanePath) {
            this.serveControlPlane(req, res);

            return;
        }

        // Anonymous page load goes to the portal.
        if (isPageRequest && !hasCredential) {
            this.redirectToPortal(res);

            return;
        }

        const acceptsTraffic = Workspace.Lifecycle.acceptsTraffic(siloTicket.lifecycleState);

        // Stopped or disabled: nothing may wake it.
        if (!acceptsTraffic) {
            if (isPageRequest)
                this.redirectToPortal(res);
            else
                this.refuseStoppedOrDisabled(res, siloTicket);

            return;
        }

        // Out of executions.
        if (isMeteredPath) {
            const isLocked = await this.entitlementService.isLocked(siloTicket.workspaceId);

            if (isLocked) {
                this.refuseOverLimit(res);

                return;
            }
        }

        if (siloTicket.backendAddress) {
            this.forward(req, res, siloTicket, siloTicket.backendAddress);

            return;
        }

        // A webhook URL is its own credential; anything else needs one to spend a boot.
        if (!isWebhookPath && !hasCredential) {
            res.writeHead(401, { 'Content-Type': 'text/plain' }).end('Unauthorized\n');

            return;
        }

        // Everyone waits a little; a webhook waits as long as its sender would.
        const waitMs = isWebhookPath ? WEBHOOK_WAIT_MS : REQUEST_WAIT_MS;

        const wakeStartedAt = Date.now();

        const target = await withinTimer(this.wakeWorkspace(siloTicket), waitMs);

        timings.wake = Date.now() - wakeStartedAt;

        if (!target) {
            this.refuseStarting(req, res);

            return;
        }

        // Sender may have given up while it booted.
        if (req.destroyed || res.writableEnded)
            return;

        this.forward(req, res, siloTicket, target);
    }

    // Same shape as the workspace's own errors, so the editor shows the message.
    private refuseStoppedOrDisabled(res: ServerResponse, siloTicket: Router.SiloTicket): void {
        const disabled = siloTicket.lifecycleState === 'disabled';

        res.writeHead(disabled ? 402 : 503, { 'Content-Type': 'application/json' }).end(JSON.stringify({
            status: disabled ? 402 : 503,
            error: {
                code:    disabled ? 'WORKSPACE_DISABLED' : 'WORKSPACE_STOPPED',
                message: disabled
                    ? 'This workspace has been disabled.'
                    : 'This workspace has been turned off by its owner.',
                detail: disabled
                    ? siloTicket.disabledReason ?? 'Settle the account to bring it back.'
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

    private forward(req: IncomingMessage, res: ServerResponse, siloTicket: Router.SiloTicket, target: URL): void {
        if (Router.isMeteredPath(req.method, req.url))
            (req as Metered)[METERED] = siloTicket.workspaceId;

        const timings = (req as Timed)[TIMINGS];

        if (timings)
            timings.forwardedAt = Date.now();

        this.proxy.web(
            req,
            res,
            {
                target:  target.toString(),
                headers: { [TRUST_HEADER]: siloTicket.routerSecret },
            },
            (error) => void this.onUpstreamError(error, req, siloTicket, res),
        );
    }

    // Address once serving, or null past the budget.

    // Counts an execution from the response body without touching the forwarded bytes.
    // Also graces one overpassing
    private stampServerTiming(req: IncomingMessage, res: ServerResponse): void {
        const timings = (req as Timed)[TIMINGS];

        if (!timings || res.headersSent)
            return;

        const entries: string[] = [];

        if (timings.ticket !== undefined)
            entries.push(`ticket;dur=${timings.ticket}`);

        if (timings.wake !== undefined)
            entries.push(`wake;dur=${timings.wake}`);

        if (timings.forwardedAt !== undefined)
            entries.push(`upstream;dur=${Date.now() - timings.forwardedAt}`);

        if (entries.length === 0)
            return;

        res.setHeader('Server-Timing', entries.join(', '));
    }




    private handleMeteredPath(proxyRes: IncomingMessage, req: IncomingMessage): void {
        const workspaceId = (req as Metered)[METERED];

        if (!workspaceId)
            return;

        const status = proxyRes.statusCode ?? 0;

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

            // Not awaited.
            void this.entitlementService
                     .executions
                     .recordAndLockIfOver(
                        workspaceId, found?.executionId ?? null, found?.igniter ?? null
                      )
                     .catch(
                        (error: unknown) => this.logger.error(`Could not record usage for ${workspaceId}: ${error instanceof Error ? error.message : error}`)
                    );
        });
    }

    // Both response shapes a started execution has.
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

    // This process, on its Nest port.
    // The primary region when this machine runs elsewhere; API work belongs next to the database.
    private static getReplayRegion(req: IncomingMessage): string | null {
        const region  = process.env.FLY_REGION;
        const primary = process.env.PRIMARY_REGION;

        // The platform's own check must be answered by the machine it is checking.
        if (req.url === '/health')
            return null;

        return region && primary && region !== primary ? primary : null;
    }

    private serveControlPlane(req: IncomingMessage, res: ServerResponse): void {
        const replayRegion = ProxyService.getReplayRegion(req);

        if (replayRegion) {
            res.writeHead(204, { 'fly-replay': `region=${replayRegion}` }).end();

            return;
        }

        const origin = `http://127.0.0.1:${process.env.PORT ?? 4000}`;

        this.proxy.web(req, res, { target: origin }, (error) => {
            this.logger.warn(`Control plane forward failed: ${error.message}`);

            if (!res.headersSent)
                res.writeHead(502, { 'Content-Type': 'text/plain' }).end('Bad Gateway\n');
        });
    }

    private redirectToPortal(res: ServerResponse): void {
        res.writeHead(302, { Location: requireEnv('PORTAL_URL'), 'Cache-Control': 'no-store' }).end();
    }

    // 503 + Retry-After; a browser gets the self-refreshing page.
    private refuseStarting(req: IncomingMessage, res: ServerResponse): void {
        const headers = { 'Retry-After': String(RETRY_AFTER_S), 'Cache-Control': 'no-store' };

        if (!ProxyService.isPageRequest(req)) {
            res.writeHead(503, { ...headers, 'Content-Type': 'text/plain' }).end('Workspace is starting\n');

            return;
        }

        res.writeHead(503, { ...headers, 'Content-Type': 'text/html; charset=utf-8' }).end(STARTING_PAGE);
    }

    // Refused connection means the machine went away: drop the route, tell the client to retry.
    private async onUpstreamError(error: Error, req: IncomingMessage, siloTicket: Router.SiloTicket, res: ServerResponse): Promise<void> {
        const unreachable = ['ECONNREFUSED', 'EHOSTUNREACH', 'ENOTFOUND', 'ECONNRESET']
            .includes((error as NodeJS.ErrnoException).code ?? '');

        this.router.invalidateAddress(siloTicket.workspaceId);

        if (!unreachable) {
            this.logger.warn(`Upstream failed for ${siloTicket.workspaceId}: ${error.message}`);

            if (!res.headersSent)
                res.writeHead(502, { 'Content-Type': 'text/plain' }).end('Bad Gateway\n');

            return;
        }

        if (Router.isWebhookPath(req.url) || ProxyService.hasCredential(req))
            void this.wakeWorkspace(siloTicket);

        if (!res.headersSent)
            res
                .writeHead(503, { 'Retry-After': String(RETRY_AFTER_S), 'Content-Type': 'text/plain' })
                .end('Workspace is starting\n');
    }

    // Anything but a clean forward closes the socket.
    public async handleWebSocketUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
        if (Router.isControlPlaneHost(req)) {
            const replayRegion = ProxyService.getReplayRegion(req);

            // Answered before the upgrade, so the platform replays the handshake in the primary region.
            if (replayRegion) {
                socket.end(`HTTP/1.1 204 No Content\r\nfly-replay: region=${replayRegion}\r\nContent-Length: 0\r\n\r\n`);

                return;
            }

            this.proxy.ws(req, socket, head, { target: `http://127.0.0.1:${process.env.PORT ?? 4000}` }, (error: Error) => {
                this.logger.warn(`Control plane upgrade failed: ${error.message}`);

                socket.destroy();
            });

            return;
        }

        const siloTicket = await this.router.getTicket(req);

        if (siloTicket?.kind === 'hooks') {
            socket.destroy();
            return;
        }

        if (!siloTicket?.backendAddress) {
            if (siloTicket)
                void this.wakeWorkspace(siloTicket);

            socket.destroy();
            return;
        }

        this.proxy.ws(req, socket, head, {
            target:  siloTicket.backendAddress.toString(),
            headers: { [TRUST_HEADER]: siloTicket.routerSecret },
        });
    }

    // Starts the workspace once.
    // Starts it if it is not up, and resolves to its address once serving. Void the promise to not wait.
    // Starts the backend and resolves to its address once it answers. Void the promise to not wait.
    private wakeWorkspace(siloTicket: Router.SiloTicket): Promise<URL | null> {
        const { workspaceId } = siloTicket;

        const inFlight = this.waking.get(workspaceId);

        if (inFlight)
            return inFlight;

        const wake = this.wake(workspaceId)
            .finally(() => this.waking.delete(workspaceId));

        this.waking.set(workspaceId, wake);

        return wake;
    }




    private async wake(workspaceId: Workspace.Id): Promise<URL | null> {
        const isCoolingDown = this.globalCachingService.get(WAKE_COOLDOWN_CHANNEL, workspaceId);

        if (isCoolingDown)
            return null;

        this.logger.log(`Waking ${workspaceId}`);

        try {
            let address = await this.hardwareService.lifecycle.wakeBackend(workspaceId);

            // No machine at all: it was reclaimed, and only a rebuild brings it back.
            if (!address) {
                await this.workspaceService.ensureStarted(workspaceId);

                address = await this.router.invalidateAddress(workspaceId);
            }
            else {
                this.router.setAddress(workspaceId, address);

                // Awaited: the next request reads the lifecycle before the address, and must see running.
                await this.workspaceService.markRunning(workspaceId);
            }

            return address;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            this.logger.error(`Could not wake ${workspaceId}: ${message}`);

            this.globalCachingService.set(WAKE_COOLDOWN_CHANNEL, workspaceId, true);

            return null;
        }
    }
}
