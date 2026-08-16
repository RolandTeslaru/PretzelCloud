import { z } from "zod"
import { User } from "../User"
import { Role as RoleSchema, atLeast as roleAtLeast } from "./role"
import { WorkspaceId, createId as createWorkspaceId } from "./ids"
import * as MemberMod from "./member"

// A workspace as the portal knows it: desired state. What has been materialized
// for it lives in Fleet, on another credential.
export namespace Workspace {

    export const Id = WorkspaceId
    export type  Id = WorkspaceId
    export const createId = createWorkspaceId

    export const Role = RoleSchema
    export type  Role = z.infer<typeof RoleSchema>
    export const atLeast = roleAtLeast

    // 'failed' is not a state the user sees. A workspace that cannot be
    // provisioned is torn down and its row deleted, so they simply retry; the
    // row survives only when teardown itself failed and the reconciler still
    // has work to do.
    export const Status = z.enum(["provisioning", "ready", "suspended", "failed"])
    export type  Status = z.infer<typeof Status>

    export const Plan = z.enum(["free", "pro"])
    export type  Plan = z.infer<typeof Plan>

    // The subdomain. Random rather than derived from the name — a guessable
    // workspace hostname is an invitation to probe the fleet.
    export const Slug = z.string().regex(/^ws-[a-z0-9]{8}$/)
    export type  Slug = z.infer<typeof Slug>

    export const DisplayName = z.string().trim()
        .min(1, 'Workspace name is required')
        .max(64, 'Workspace name must be at most 64 characters')

    export import Member = MemberMod.Member

    export const Schema = z.object({
        id:           Id,
        slug:         Slug,
        display_name: z.string(),
        status:       Status,
        plan:         Plan,
        created_by:   User.Id.nullable(),
        created_at:   z.coerce.date(),
        updated_at:   z.coerce.date(),
    })

    // A workspace as a grid card sees it: the workspace plus the caller's own
    // standing in it.
    export const Card = Schema.extend({
        role: Role,
    })
    export type Card = z.infer<typeof Card>
}
export type Workspace = z.infer<typeof Workspace.Schema>
