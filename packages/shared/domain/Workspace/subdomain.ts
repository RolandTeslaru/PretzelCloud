import { z } from "zod"
import { WorkspaceId } from "./ids"

/**
 * The leftmost label of a workspace's hostnames.
 *
 * A leaf module because Fleet.Hostname builds from it and Workspace re-exports
 * it: importing this directly rather than through Workspace/index is what keeps
 * the two free of a cycle.
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
    export const canonical = (id: WorkspaceId) =>
        Schema.parse(`${PREFIX}${id.replace(/-/g, '').slice(0, 16)}`)
}
export type Subdomain = z.infer<typeof Subdomain.Schema>
