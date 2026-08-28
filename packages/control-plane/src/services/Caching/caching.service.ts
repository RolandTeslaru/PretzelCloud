import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Realtime } from "@pretzel-cloud/shared/domain";
import z from "zod";
import { RealtimeService } from "../Realtime/realtime.service";

type EntryKey = string
type EntryValue = { value: any, expiresAt: number }

/**
 * Whether a write travels. Replicating warms an instance from its peers, but
 * puts the value on the bus — so anything holding a secret fills from its own
 * source and shares only what it drops.
 */
type Registration = { ttlMs: number, max: number, replicate: boolean }

/** How often every cache is walked. Writes make room on their own; this is for what is never written again. */
const SWEEP_MS = 60_000


export namespace GlobalCaching {
    export const Channel = Realtime.Channel.brand("GlobalCaching.Channel")
    export type  Channel = z.infer<typeof Channel>

    export namespace Event {

        export const Base = Realtime.Event.Base.extend({
            channel: Channel,
        })

        export namespace Set {
            export const Schema = Base.extend({
                type:      z.literal("set"),
                key:       z.string(),
                value:     z.any(),
                expiresAt: z.number()
            })
        }

        export namespace Delete {
            export const Schema = Base.extend({
                type: z.literal("delete"),
                key:  z.string()
            })
        }

        export namespace Clear {
            export const Schema = Base.extend({
                type: z.literal("clear")
            })
        }

        export const Schema = z.discriminatedUnion("type", [Set.Schema, Delete.Schema, Clear.Schema])
    }
    export type GlobalEvent = z.infer<typeof Event.Schema>
}

@Injectable()
export class GlobalCachingService implements OnModuleInit, OnModuleDestroy {
    constructor (
        private readonly realtime: RealtimeService
    ){

    }

    private sweepTimer: NodeJS.Timeout | null = null

    public onModuleInit() {
        this.sweepTimer = setInterval(() => this.registry.forEach((_, channel) => this.prune(channel)), SWEEP_MS)

        // Don't keep the event loop alive just to drop expired entries.
        this.sweepTimer.unref()
    }

    public onModuleDestroy() {
        if(this.sweepTimer)
            clearInterval(this.sweepTimer)
    }

    private registry = new Map<GlobalCaching.Channel, Registration>

    private caches = new Map<GlobalCaching.Channel, Map<EntryKey, EntryValue>>

    public create(channel: GlobalCaching.Channel, ttlMs: number, max: number, replicate = true){

        // A second registration would subscribe twice and apply every message
        // as many times, and silently drop whatever the first one held.
        if(this.registry.has(channel))
            throw new Error(`Cache for channel ${channel} already exists`)

        this.registry.set(channel, { ttlMs, max, replicate })
        this.caches.set(channel, new Map());

        this.realtime.subscribe(channel, (e) => {
            const event = GlobalCaching.Event.Schema.parse(e)
            const cache = this.caches.get(channel)

            if(event.type === "set"){
                cache?.delete(event.key)
                cache?.set(event.key, { value: event.value, expiresAt: event.expiresAt })
            } else if (event.type === "delete"){
                cache?.delete(event.key)
            } else if (event.type === "clear"){
                cache?.clear()
            }
        })
    }

    public get(channel: GlobalCaching.Channel, key: string){
        const cache = this.caches.get(channel)
        if(!cache)
            throw new Error(`Cache for channel ${channel} doesnt exist`)

        const hit = cache.get(key);

        if(!hit)
            return undefined

        // Dropped here and nowhere else: every instance holds the same
        // expiry, so each reaches this on its own.
        if(hit.expiresAt <= Date.now()){
            cache.delete(key)
            return undefined
        }

        return hit.value
    }

    public set(channel: GlobalCaching.Channel, key: EntryKey, value: any){
        const cache = this.caches.get(channel)
        const entry = this.registry.get(channel)
        if(!cache || !entry)
            throw new Error(`Cache for channel ${channel} doesnt exist.`)

        this.makeRoom(channel)


        const ttlMs = entry.ttlMs

        const expiresAt = Date.now() + ttlMs

        // Deleted first so the key moves to the back: the ttl is the channel's,
        // so insertion order is expiry order and the front is always the soonest.
        cache.delete(key)
        cache.set(key, {value, expiresAt })

        if(!entry.replicate)
            return

        const event = GlobalCaching.Event.Schema.parse({
            channel,
            type: "set",
            value,
            key,
            expiresAt
        })

        this.realtime.publish(channel, event)
    }

    public delete(channel: GlobalCaching.Channel, key: EntryKey){
        const cache = this.caches.get(channel)
        if(!cache)
            throw new Error(`Cache for channel ${channel} doesnt exist`)

        cache.delete(key);

        const event = GlobalCaching.Event.Schema.parse({
            channel,
            type: "delete",
            key,
        })

        this.realtime.publish(channel, event)
    }


    /** Every entry, everywhere. For a change too broad to name a key for. */
    public clear(channel: GlobalCaching.Channel){
        const cache = this.caches.get(channel)
        if(!cache)
            throw new Error(`Cache for channel ${channel} doesnt exist`)

        cache.clear()

        const event = GlobalCaching.Event.Schema.parse({
            channel,
            type: "clear",
        })

        this.realtime.publish(channel, event)
    }




    public size(channel: GlobalCaching.Channel){
        const cache = this.caches.get(channel)
        if(!cache)
            throw new Error(`Cache for channel ${channel} doesnt exist`)

        return cache.size
    }




    private makeRoom(channel: GlobalCaching.Channel){
        const cache = this.caches.get(channel)
        const entry = this.registry.get(channel)

        if(!cache || !entry)
            throw new Error(`Cannot make room in channel ${channel}`)

        // No pruning here: the front is the soonest to expire, so evicting it
        // drops an expired entry before a live one without walking anything.
        while (cache.size >= entry.max){
            const oldest = cache.keys().next();

            if(oldest.done)
                return

            cache.delete(oldest.value)
        }
    }

    public prune(channel: GlobalCaching.Channel) {
        const now = Date.now();

        const cache = this.caches.get(channel)

        if(!cache)
            throw new Error(`Cannot prune channel ${channel}`)

        // Sorted by expiry, so the first live entry ends it.
        for (const [key, entry] of cache){
            if (entry.expiresAt > now)
                return

            cache.delete(key)
        }
    }
}
