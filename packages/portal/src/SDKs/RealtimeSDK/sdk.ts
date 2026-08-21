import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { BaseSDK } from "@pretzel-graph/standard-ui/SDKs/Base";
import { SDK } from "@pretzel-graph/standard-ui/SDKs/SDKManager";
import type { Realtime } from "@pretzel-cloud/shared/domain";
import { getToken } from "../AuthSDK/client";

/** Same origin as the page unless the control plane is somewhere else. */
export const socketUrl = (): string => {
    const configured = import.meta.env?.VITE_CONTROL_PLANE_URL;

    const base = configured
        ? new URL(configured)
        : window.location;

    const protocol = base.protocol === "https:" ? "wss:" : "ws:";

    return `${protocol}//${base.host}/socket`;
};

@SDK("Realtime")
export class RealtimeSDKImpl extends BaseSDK<RealtimeSDK.State> {
    constructor() { super() }

    public readonly useStore: BaseSDK.Store<RealtimeSDK.State> = create(
        immer<RealtimeSDK.State>(() => ({
            isConnected: false
        }))
    )

    private socket: WebSocket | null = null;
    private listeners = new Map<Realtime.Channel, Set<(data: any, websocketMessage: MessageEvent<any>) => void>>();

    public subscribeToChannel<T>(
        channel:  Realtime.Channel,
        callback: (data: T, websocketMessage: MessageEvent<T>) => void
    ) {
        if (!this.listeners.has(channel)) {
            this.listeners.set(channel, new Set());
            // Tell the control plane to subscribe us to this Redis channel
            this.send({ action: "subscribe", channel });
        }
        this.listeners.get(channel)!.add(callback);

        return () => {
            const channelListeners = this.listeners.get(channel);
            if (!channelListeners)
                return

            channelListeners.delete(callback);
            // If no more listeners for this channel, unsubscribe
            if (channelListeners.size === 0) {
                this.listeners.delete(channel);
                this.send({ action: "unsubscribe", channel });
            }
        };
    }

    private send(message: any) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            // Not an error: subscriptions registered before the socket opens are
            // replayed on connect.
            return;
        }

        this.socket.send(JSON.stringify(message));
    }

    private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    private reconnectAttempts = 0;
    private readonly MAX_RECONNECT_DELAY = 30000; // 30 seconds
    private readonly BASE_RECONNECT_DELAY = 1000; // 1 second
    private currentUrl: string | null = null;
    private isIntentionalClose = false;

    public async connect(url: string) {
        this.currentUrl = url;
        this.isIntentionalClose = false;

        if (this.socket)
            this.socket.close();

        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        // Read on every attempt, not baked into a stored URL: a reconnect an
        // hour later must not carry the token this one started with.
        const token = await getToken();
        const separator = url.includes('?') ? '&' : '?';
        const authenticatedUrl = token ? `${url}${separator}token=${token}` : url;

        this.socket = new WebSocket(authenticatedUrl);

        this.socket.onopen = () => {
            this.useStore.setState(s => {
                s.isConnected = true;
            });
            this.reconnectAttempts = 0;

            // Resubscribe to existing channels if any (reconnection logic)
            this.listeners.forEach((_, channel) => {
                this.send({ action: "subscribe", channel });
            });
        };

        this.socket.onclose = () => {
            this.useStore.setState(s => { s.isConnected = false; });

            if (!this.isIntentionalClose) {
                this.scheduleReconnect();
            }
        };

        this.socket.onmessage = (message) => {
            try {
                const event = JSON.parse(message.data) as Realtime.Event;
                // Expecting message to have a channel field (from Event.Base)
                const channel = event.channel as Realtime.Channel;

                if (channel && this.listeners.has(channel)) {
                    this.listeners.get(channel)!.forEach(callback => callback(event, message));
                }
            } catch (err) {
                console.error("RealtimeSDK: Failed to parse message", err);
            }
        };
    }

    private scheduleReconnect() {
        if (this.reconnectTimeout) return;

        // Exponential backoff with jitter to prevent thundering herd
        const delay = Math.min(
            this.BASE_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts),
            this.MAX_RECONNECT_DELAY
        );
        const jitter = Math.random() * 1000; // 0-1000ms jitter

        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            this.reconnectAttempts++;
            if (this.currentUrl) {
                this.connect(this.currentUrl);
            }
        }, delay + jitter);
    }

    public disconnect() {
        this.isIntentionalClose = true;
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
    }
}

export const RealtimeSDK = SDK.get<RealtimeSDKImpl>("Realtime")

export namespace RealtimeSDK {

    export type State = {
        isConnected: boolean;
    }
}
