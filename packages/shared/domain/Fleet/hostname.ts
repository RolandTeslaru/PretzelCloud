import { z } from "zod"
import { WorkspaceId } from "../Workspace/ids"

export namespace Hostname {

    // 'app' is the editor, 'hooks' is inbound webhooks. Separate hostnames so
    // the two can be rate-limited and routed independently.
    export const Kind = z.enum(["app", "hooks"])
    export type  Kind = z.infer<typeof Kind>

    export const Schema = z.object({
        host:         z.string(),
        workspace_id: WorkspaceId,
        kind:         Kind,
        created_at:   z.coerce.date(),
    })

    export const build = (slug: string, kind: Kind, domain: string) => `${slug}.${kind}.${domain}`
}
export type Hostname = z.infer<typeof Hostname.Schema>
