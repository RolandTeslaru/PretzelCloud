import { z } from "zod"

/**
 * The transport primitive. A channel name, and the shape everything travelling
 * on one shares — no product knowledge of its own.
 *
 * A domain extends `Event.Base` with its own addressing and names a channel
 * convention; see Workspace.Event. Events are outbound only, server to client.
 * Commands travel over the API.
 */
export namespace Realtime {

    export const Channel = z.string().brand("Channel")
    export type  Channel = z.infer<typeof Channel>

    export namespace Event {

        export const Type = z.string()
        export type  Type = z.infer<typeof Type>

        export const Base = z.object({
            channel: Channel,
            type:    Type,
        })

        /**
         * Addressing: which entity a member belongs to and where it travels.
         * Wholly determined by that entity, so it is never a construction
         * argument — whatever publishes the member derives it and writes it.
         *
         * An event as constructed, before those fields are filled in.
         */
        export type Unstamped<T_Event, T_Stamped extends PropertyKey> =
            T_Event extends unknown ? Omit<T_Event, T_Stamped> : never

        /**
         * Builds a domain's `create` from its union, so each one owns a typed
         * factory without a hand-written copy of the OfType/Rest/RestArg block.
         *
         * The schema is the inference source only — nothing is parsed. The
         * result is addressless by construction, so there is no complete member
         * here to validate. `stamped` is a value rather than a type argument
         * because TypeScript cannot infer one type parameter and be told the
         * other.
         */
        export function defineFactory<
            T_Schema extends z.ZodType<z.infer<typeof Base>>,
            const T_Stamped extends readonly (keyof z.infer<T_Schema>)[],
        >(_schema: T_Schema, _stamped: T_Stamped) {

            type Event = z.infer<T_Schema>

            type Stamped = T_Stamped[number]

            type OfType<T extends Event["type"]> = Extract<Event, { type: T }>

            type Rest<T extends Event["type"]> = Omit<OfType<T>, Stamped | "type">

            /**
             * Variants with no fields of their own take no second argument.
             * `Record<string, never>` rather than `Rest<T>` for that case: it is
             * `{}` there, which accepts any object rather than refusing every
             * property.
             */
            type RestArg<T extends Event["type"]> =
                {} extends Rest<T> ? [rest?: Record<string, never>] : [rest: Rest<T>]

            return function create<T extends Event["type"]>(
                type:      T,
                ...[rest]: RestArg<T>
            ): Unstamped<OfType<T>, Stamped> {
                // Through unknown: `Unstamped` distributes over the union, which
                // keeps each variant's own fields, and a distributive conditional
                // never overlaps its input by inspection.
                return { ...rest, type } as unknown as Unstamped<OfType<T>, Stamped>
            }
        }

        /** Sent in place of a subscription the caller may not have. */
        export namespace Forbidden {
            export const Schema = Base.extend({
                type:    z.literal("forbidden"),
                message: z.string(),
            })
            export type Schema = z.infer<typeof Schema>
        }
        export type Forbidden = z.infer<typeof Forbidden.Schema>
    }
    export type Event = z.infer<typeof Event.Base>
}
