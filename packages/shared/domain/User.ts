import { z } from "zod"

// A subject of the fleet issuer. The issuer owns the credentials; this is the
// profile the portal renders.
export namespace User {

    export const Id = z.uuid().brand("UserId")
    export type  Id = z.infer<typeof Id>

    export const createId = () => crypto.randomUUID() as Id

    export const Schema = z.object({
        id:          Id,
        email:       z.email(),
        displayName: z.string(),
        avatarUrl:   z.string().nullable(),
        createdAt:   z.coerce.date(),
        updatedAt:   z.coerce.date(),
    })

    // Editable profile fields. Excludes email — the issuer owns it, and changing
    // it needs a confirmation round trip.
    export const DisplayName = z.string().trim()
        .min(1, 'Display name is required')
        .max(64, 'Display name must be at most 64 characters')
}
export type User = z.infer<typeof User.Schema>
