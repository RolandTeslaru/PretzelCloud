import { z } from "zod"
import { Workspace } from "./Workspace"

// A workflow a workspace shares with every other workspace: one copy per
// listing, the owner's current active publication, stored verbatim.
export namespace Listing {

    // The fixed first group makes a listing id recognisable from the value alone.
    export const ID_PREFIX = "115ed000"

    export const isListingId = (value: string): boolean =>
        value.startsWith(ID_PREFIX)

    export const Id = z.uuid().refine(isListingId).brand("ListingId")
    export type  Id = z.infer<typeof Id>

    export const createId = (): Id =>
        `${ID_PREFIX}${crypto.randomUUID().slice(ID_PREFIX.length)}` as Id

    // Opaque here: the workspace that reads it is the one that validates it.
    export const Data = z.record(z.string(), z.unknown())
    export type  Data = z.infer<typeof Data>

    // Largest workflowData accepted, in bytes of JSON.
    export const MAX_DATA_BYTES = 1_000_000


    export const Schema = z.object({
        id:              Id,
        workspaceId:     Workspace.Id,
        publicationMeta: Data,
        workflowData:    Data,
        blueprintId:     z.string().nullable(),
        createdAt:       z.coerce.date(),
        updatedAt:       z.coerce.date(),
    })

    export namespace API {


        export namespace Get {
            export const Response = z.object({ workflow: Schema })
            export type  Response = z.infer<typeof Response>
        }

        export namespace Updates {
            // `ids` is one comma-separated query parameter.
            export const Request = z.object({
                ids: z.string().transform((raw) => raw.split(",").filter(Boolean)).pipe(z.array(Id).max(100)),
            })
            export type Request = z.infer<typeof Request>

            export const Response = z.object({ updates: z.record(Id, Data) })
            export type  Response = z.infer<typeof Response>
        }

        // Without `id` the registry mints one.
        export namespace Put {
            export const Request = z.object({
                id:              Id.optional(),
                publicationMeta: Data,
                workflowData:    Data,
            })
            export type Request = z.infer<typeof Request>

            export const Response = z.object({ id: Id })
            export type  Response = z.infer<typeof Response>
        }
    }
}
export type Listing = z.infer<typeof Listing.Schema>
