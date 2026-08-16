import { z } from "zod"
import { User } from "../User"
import { WorkspaceId, createId as createWorkspaceId } from "./ids"

// A workspace as the portal knows it: desired state. What has been materialized
// for it lives in Fleet, on another credential.
export namespace Workspace {

    export const Id = WorkspaceId
    export type  Id = WorkspaceId
    export const createId = createWorkspaceId

    // 'failed' is not a state the user sees. A workspace that cannot be
    // provisioned is torn down and its row deleted, so they simply retry; the
    // row survives only when teardown itself failed and the reconciler still
    // has work to do.
    export const Status = z.enum(["provisioning", "ready", "suspended", "failed"])
    export type  Status = z.infer<typeof Status>

    export const Plan = z.enum(["free", "pro"])
    export type  Plan = z.infer<typeof Plan>

    /**
     * The leftmost label of a workspace's hostnames.
     *
     * Every workspace always answers at `canonical(id)`, which is derived rather
     * than stored — it cannot drift from the id and cannot be edited. Paid plans
     * may set an additional custom one; the canonical host stays registered
     * either way, so changing the custom name never breaks a webhook URL a third
     * party is holding.
     */
    export namespace Subdomain {

        export const Schema = z.string().brand("Workspace.Subdomain")

        export const PREFIX = "wspace-"

        /** Names the fleet keeps for itself, plus anything that could impersonate. */
        export const RESERVED = new Set([
            "www", "app", "api", "hooks", "admin", "mail", "smtp", "ftp",
            "status", "docs", "blog", "help", "support", "cdn", "static",
            "assets", "auth", "login", "account", "billing", "portal", "internal",
        ])

        export const Custom = z.string().trim().toLowerCase()
            .regex(/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/, 'Letters, numbers and hyphens; 3-32 characters, not starting or ending with a hyphen')
            .refine((value) => !value.startsWith(PREFIX), 'That prefix is reserved')
            .refine((value) => !RESERVED.has(value), 'That name is reserved')
            .pipe(Schema)

        /** Immutable, because the id is. Never stored. */
        export const canonical = (id: Id) =>
            Schema.parse(`${PREFIX}${id.replace(/-/g, '').slice(0, 16)}`)
    }
    export type Subdomain = z.infer<typeof Subdomain.Schema>

    export const DisplayName = z.string().trim()
        .min(1, 'Workspace name is required')
        .max(64, 'Workspace name must be at most 64 characters')

    export const Schema = z.object({
        id:          Id,
        // Null until a paid plan sets one; the canonical host is derived.
        subdomain:   Subdomain.Schema.nullable(),
        displayName: z.string(),
        status:      Status,
        plan:        Plan,
        ownerId:     User.Id,
        createdAt:   z.coerce.date(),
        updatedAt:   z.coerce.date(),
    })

    // A workspace as a grid card sees it. Roles live in the workspace's own
    // database, so the only standing the portal knows is whether you own it —
    // which is also the only one the grid needs, to decide on a delete button.
    export const Card = Schema.extend({
        isOwner: z.boolean(),
    })
    export type Card = z.infer<typeof Card>

    // Inline rather than a sibling file: these reference Schema, Card and
    // Subdomain above, and a separate module importing back into this one would
    // be a cycle that leaves the zod schemas undefined at load.
    export namespace API {

        export namespace List {
            export const Response = z.object({ workspaces: z.array(Card) })
            export type  Response = z.infer<typeof Response>
        }

        export namespace Create {
            export const Request = z.object({ displayName: DisplayName })
            export type  Request = z.infer<typeof Request>

            export const Response = z.object({ workspace: Schema })
            export type  Response = z.infer<typeof Response>
        }

        export namespace Get {
            export const Response = z.object({ workspace: Schema })
            export type  Response = z.infer<typeof Response>
        }

        export namespace Rename {
            export const Request = z.object({ displayName: DisplayName })
            export type  Request = z.infer<typeof Request>

            export const Response = z.object({})
            export type  Response = z.infer<typeof Response>
        }

        // Null clears it. Paid plans only; the canonical host is unaffected.
        export namespace SetSubdomain {
            export const Request = z.object({ subdomain: Subdomain.Custom.nullable() })
            export type  Request = z.infer<typeof Request>

            export const Response = z.object({})
            export type  Response = z.infer<typeof Response>
        }

        export namespace Destroy {
            export const Response = z.object({})
            export type  Response = z.infer<typeof Response>
        }

    }
}
export type Workspace = z.infer<typeof Workspace.Schema>

