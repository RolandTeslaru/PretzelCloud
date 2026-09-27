import { z } from "zod"
import { Workspace } from "./Workspace"

// A workflow a workspace shares with every other workspace: one version per
// PretzelGraph release step, each a deployed publication stored verbatim.
export namespace Listing {

    // The fixed first group makes a listing id recognisable from the value alone.
    export const ID_PREFIX = "115ed000"

    export const isListingId = (value: string): boolean =>
        value.startsWith(ID_PREFIX)

    export const Id = z.uuid().refine(isListingId).brand("ListingId")
    export type  Id = z.infer<typeof Id>

    export const createId = (): Id =>
        `${ID_PREFIX}${crypto.randomUUID().slice(ID_PREFIX.length)}` as Id

    // The extended shelf entries every new workspace starts with a copy of.
    export namespace Starter {
        export const BLUEPRINT_IDS = ["Pretzel.Starter.HelloFlow", "Pretzel.Starter.Agent"] as const
    }

    // The owner's local workflow id; unique together with the owner.
    export const WorkflowId = z.uuid()
    export type  WorkflowId = z.infer<typeof WorkflowId>

    // Opaque here: the workspace that reads it is the one that validates it.
    export const Data = z.record(z.string(), z.unknown())
    export type  Data = z.infer<typeof Data>

    // Largest workflowData accepted, in bytes of JSON.
    export const MAX_DATA_BYTES = 1_000_000

    // A PretzelGraph version, e.g. 0.0.732; build metadata after + is ignored when comparing.
    export const Release = z.string().regex(/^\d+(\.\d+)*(\+[\w.-]+)?$/)
    export type  Release = z.infer<typeof Release>

    export const Schema = z.object({
        id:              Id,
        workspaceId:     Workspace.Id,
        workflowId:      WorkflowId,
        publicationMeta: Data,
        workflowData:    Data,
        blueprintId:     z.string().nullable(),
        version:         z.number().int(),
        release:         Release,
        publishedAt:     z.coerce.date(),
        createdAt:       z.coerce.date(),
    })

    export namespace API {

        // Every read that serves a graph resolves for the caller's release.
        export const ReleaseQuery = z.object({ release: Release })

        export namespace Get {
            export const Response = z.object({ workflow: Schema })
            export type  Response = z.infer<typeof Response>
        }

        export namespace Updates {
            // `ids` is one comma-separated query parameter.
            export const Request = z.object({
                ids:     z.string().transform((raw) => raw.split(",").filter(Boolean)).pipe(z.array(Id).max(100)),
                release: Release,
            })
            export type Request = z.infer<typeof Request>

            export const Response = z.object({ updates: z.record(Id, Data) })
            export type  Response = z.infer<typeof Response>
        }

        // A workspace's own listings, keyed by its workflow ids.
        export namespace Owned {
            export const Response = z.object({ listings: z.record(WorkflowId, Id) })
            export type  Response = z.infer<typeof Response>
        }

        // The publication to serve; the workflow is named in the path.
        export namespace Put {
            export const Request = z.object({
                publicationMeta: Data,
                workflowData:    Data,
                // The release the publication was built on.
                release:         Release,
            })
            export type Request = z.infer<typeof Request>

            export const Response = z.object({ id: Id })
            export type  Response = z.infer<typeof Response>
        }
    }
}
export type Listing = z.infer<typeof Listing.Schema>
