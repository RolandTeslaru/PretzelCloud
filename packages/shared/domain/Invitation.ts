import { z } from "zod"
import { User } from "./User"
import { Role } from "./Workspace/role"
import { WorkspaceId } from "./Workspace/ids"

// An invitee is not yet a member, so an invitation is read by address rather
// than by membership. Only the hash is stored; the token itself is shown once,
// in the link.
export namespace Invitation {

    export const Id = z.uuid().brand("InvitationId")
    export type  Id = z.infer<typeof Id>

    // Owner is not invitable — it is taken at provisioning and transferred, never granted.
    export const InviteRole = Role.exclude(["owner"])
    export type  InviteRole = z.infer<typeof InviteRole>

    export const Schema = z.object({
        id:           Id,
        workspace_id: WorkspaceId,
        email:        z.email(),
        role:         InviteRole,
        invited_by:   User.Id.nullable(),
        expires_at:   z.coerce.date(),
        accepted_at:  z.coerce.date().nullable(),
        created_at:   z.coerce.date(),
    })
}
export type Invitation = z.infer<typeof Invitation.Schema>
