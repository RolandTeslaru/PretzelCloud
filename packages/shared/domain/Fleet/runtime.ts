import { z } from "zod"
import { WorkspaceId } from "../Workspace/ids"

// Reported upward by the workspace itself. The router reads it to decide
// whether an inbound webhook is worth waking a stopped machine for.
export namespace WorkspaceRuntime {

    export const Schema = z.object({
        workspaceId:     WorkspaceId,
        hasPublications: z.boolean(),
        reportedAt:      z.coerce.date().nullable(),
    })

    export const Report = z.object({
        hasPublications: z.boolean(),
    })
    export type Report = z.infer<typeof Report>
}
export type WorkspaceRuntime = z.infer<typeof WorkspaceRuntime.Schema>
