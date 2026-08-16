import { z } from "zod"
import { User } from "../User"
import { Role } from "./role"
import { WorkspaceId } from "./ids"

// The user x workspace access index. The workspace's own database holds the
// same fact; the two are separate databases and the invitation flow reconciles
// them.
export namespace Member {

    export const Schema = z.object({
        workspace_id: WorkspaceId,
        user_id:      User.Id,
        role:         Role,
        created_at:   z.coerce.date(),
        updated_at:   z.coerce.date(),
    })

    // Members joined to the profile the portal shows beside each row.
    export const Detailed = Schema.extend({
        email:        z.email(),
        display_name: z.string(),
        avatar_url:   z.string().nullable(),
    })
    export type Detailed = z.infer<typeof Detailed>
}
export type Member = z.infer<typeof Member.Schema>
