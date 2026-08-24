import { z } from "zod"
import { Listing } from "./Listing"

// Blueprints every workspace ships beyond its own: the pinned workspace's listings.
export namespace ExtendedShelf {

    export namespace API {

        export namespace List {
            export const Response = z.object({ workflows: z.array(Listing.Schema) })
            export type  Response = z.infer<typeof Response>
        }

        export namespace Add {
            export const Request = z.object({ blueprintId: z.string().min(1) })
            export type  Request = z.infer<typeof Request>
        }
    }
}
