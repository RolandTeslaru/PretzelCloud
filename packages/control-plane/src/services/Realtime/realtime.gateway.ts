import { Logger } from '@nestjs/common';
import { WebSocketGateway, type OnGatewayConnection, type OnGatewayDisconnect } from '@nestjs/websockets';
import { WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { Realtime, Workspace } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';
import { IdentityResolver } from '@/auth/identity/identity';
import { Principal } from '@/auth/identity/principal';
import { createRedisSubscriber } from '@/utils/redis';

/**
 * The inbound side: one socket per portal tab, many channels per socket.
 *
 * Redis is subscribed once per channel however many sockets want it, and
 * dropped again when the last one leaves.
 */
@WebSocketGateway({ path: '/socket' })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {

    private readonly logger = new Logger(RealtimeGateway.name);

    private readonly redisSub = createRedisSubscriber('realtime.gateway');

    private readonly wsSubscriptions  = new Map<Realtime.Channel, Set<WebSocket>>();
    private readonly socketIdentities = new WeakMap<WebSocket, Principal.User>();

    constructor(private readonly identityResolver: IdentityResolver) {

        this.redisSub.on('message', (channel: Realtime.Channel, serializedEvent: string) => {

            const clients = this.wsSubscriptions.get(channel);

            if (!clients)
                return;

            clients.forEach((ws) => {
                if (ws.readyState === WebSocket.OPEN)
                    ws.send(serializedEvent);
            });
        });
    }

    async handleConnection(ws: WebSocket, req: IncomingMessage) {

        // Buffered rather than dropped: a subscribe can arrive while the token
        // is still being verified.
        const pending: string[] = [];

        let authenticated = false;

        ws.on('message', (data) => {
            const raw = data.toString();

            if (!authenticated) {
                pending.push(raw);
                return;
            }

            void this.handleMessage(ws, raw);
        });

        ws.on('close', () => this.handleDisconnect(ws));

        // The handshake carries no Authorization header, so the token rides the
        // query string: ws://host/socket?token=<jwt>
        const url   = new URL(req.url ?? '', `http://${req.headers.host}`);
        const token = url.searchParams.get('token');

        if (!token) {
            ws.close(1008, 'Missing authentication token');
            return;
        }

        const principal = await this.identityResolver.resolveToken(token);

        if (!principal) {
            ws.close(1008, 'Invalid authentication token');
            return;
        }

        this.socketIdentities.set(ws, principal);

        authenticated = true;

        for (const raw of pending)
            await this.handleMessage(ws, raw);
    }

    private async handleMessage(ws: WebSocket, raw: string) {
        try {
            const msg = JSON.parse(raw);

            if (msg.action === 'subscribe')
                await this.subscribe(ws, msg.channel);

            if (msg.action === 'unsubscribe')
                this.unsubscribe(ws, msg.channel);
        }
        catch (error) {
            this.logger.warn(`Invalid message: ${error instanceof Error ? error.message : error}`);
        }
    }

    handleDisconnect(ws: WebSocket) {
        this.wsSubscriptions.forEach((clients, channel) => {
            clients.delete(ws);

            if (clients.size === 0)
                this.drop(channel);
        });
    }

    private async subscribe(ws: WebSocket, channel: Realtime.Channel) {
        const principal = this.socketIdentities.get(ws);

        if (!principal)
            return this.refuse(ws, channel, 'Not authenticated');

        if (!await this.mayRead(principal, channel))
            return this.refuse(ws, channel, 'Not a member of that workspace');

        if (!this.wsSubscriptions.has(channel)) {
            this.wsSubscriptions.set(channel, new Set());

            void this.redisSub.subscribe(channel);
        }

        this.wsSubscriptions.get(channel)!.add(ws);
    }

    /**
     * A channel names a workspace, so subscribing is reaching for one. The
     * editor's own gateway never needed this — every channel there is already
     * inside the workspace the caller reached.
     */
    private async mayRead(principal: Principal.User, channel: Realtime.Channel): Promise<boolean> {
        const workspaceId = Workspace.Event.parseChannel(channel);

        if (!workspaceId)
            return false;

        const row = await PortalDB.asUser(principal, (trx) =>
            trx
                .selectFrom('workspace_members')
                .where('workspace_id', '=', workspaceId)
                .where('user_id', '=', principal.userId)
                .select('workspace_id')
                .executeTakeFirst(),
        );

        return Boolean(row);
    }

    private refuse(ws: WebSocket, channel: Realtime.Channel, message: string) {
        if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ channel, type: 'forbidden', message } satisfies Realtime.Event.Forbidden.Schema));
    }

    private unsubscribe(ws: WebSocket, channel: Realtime.Channel) {
        const clients = this.wsSubscriptions.get(channel);

        if (!clients)
            return;

        clients.delete(ws);

        if (clients.size === 0)
            this.drop(channel);
    }

    private drop(channel: Realtime.Channel) {
        this.wsSubscriptions.delete(channel);

        void this.redisSub.unsubscribe(channel);
    }
}
