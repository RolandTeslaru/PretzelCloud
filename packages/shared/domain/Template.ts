import { z } from "zod"
import { Listing } from "./Listing"

// Listings an admin offers as starting points for a new workflow.
export namespace Template {

    // Names a gallery category PretzelGraph defines; opaque here.
    export const CategoryId = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(40)
    export type  CategoryId = z.infer<typeof CategoryId>

    // The graph is not part of a template; the listing read serves it.
    export const Schema = Listing.Meta.Schema.extend({
        sortOrder:    z.number().int(),
        categoryIds:  z.array(CategoryId),
        // The blueprint of each kind of node in the graph.
        blueprintIds: z.array(z.string()),
    })

    export namespace API {

        export namespace List {
            export const Response = z.object({ templates: z.record(Listing.Id, Schema) })
            export type  Response = z.infer<typeof Response>
        }

        export namespace Set {
            export const Request = z.object({
                sortOrder:   z.number().int().default(0),
                categoryIds: z.array(CategoryId).max(20).default([]),
            })
            export type Request = z.infer<typeof Request>
        }
    }
}
export type Template = z.infer<typeof Template.Schema>
