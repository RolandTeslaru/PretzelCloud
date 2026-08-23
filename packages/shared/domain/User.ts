import { z } from "zod"
import type { AxiosInstance } from "axios"

// A subject of the fleet issuer. The issuer owns the credentials; this is the
// profile the portal renders.
export namespace User {

    export const Id = z.uuid().brand("UserId")
    export type  Id = z.infer<typeof Id>

    export const createId = () => crypto.randomUUID() as Id

    export const Schema = z.object({
        id:          Id,
        email:       z.email(),
        username:    z.string(),
        displayName: z.string(),
        avatarUrl:   z.string().nullable(),
        createdAt:   z.coerce.date(),
        updatedAt:   z.coerce.date(),
    })

    // Editable profile fields. Excludes email — the issuer owns it, and changing
    // it needs a confirmation round trip.
    export const Username = z.string().trim().toLowerCase()
        .min(3, 'Username must be at least 3 characters')
        .max(32, 'Username must be at most 32 characters')
        .regex(/^[a-z0-9_-]+$/, 'Letters, numbers, hyphens and underscores only')

    export const DisplayName = z.string().trim()
        .min(1, 'Display name is required')
        .max(64, 'Display name must be at most 64 characters')

    export namespace API {

        // Idempotent: the portal calls it once the session exists, and again on
        // every boot. The row is built from the token, never from the body.
        // Creating the profile is part of signing up, so the names are given,
        // never inferred: a username is chosen, and it is unique.
        export namespace Register {
            export const Request = z.object({
                username:    Username,
                displayName: DisplayName,
            })
            export type  Request = z.infer<typeof Request>

            export const Response = z.object({ user: Schema })
            export type  Response = z.infer<typeof Response>
        }

        export async function register(api: AxiosInstance, req: Register.Request): Promise<Register.Response> {
            const { data } = await api.put<Register.Response>('/api/me', req)
            return Register.Response.parse(data)
        }

        export namespace Get {
            export const Response = z.object({ user: Schema })
            export type  Response = z.infer<typeof Response>
        }

        export async function get(api: AxiosInstance): Promise<Get.Response> {
            const { data } = await api.get<Get.Response>('/api/me')
            return Get.Response.parse(data)
        }

        export namespace Update {
            export const Request = z.object({
                username:    Username,
                displayName: DisplayName,
            }).partial()
            export type  Request = z.infer<typeof Request>

            export const Response = z.object({ user: Schema })
            export type  Response = z.infer<typeof Response>
        }

        export async function update(api: AxiosInstance, req: Update.Request): Promise<Update.Response> {
            const { data } = await api.patch<Update.Response>('/api/me', req)
            return Update.Response.parse(data)
        }

        /** Closes the account at the issuer and here. Refuses while a workspace is owned. */
        export async function deleteAccount(api: AxiosInstance): Promise<void> {
            await api.delete('/api/me')
        }
    }
}
export type User = z.infer<typeof User.Schema>
