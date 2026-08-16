import { z } from "zod"
import { WorkspaceId } from "../Workspace/ids"

export namespace Hostname {

    // 'app' is the editor, 'hooks' is inbound webhooks. Separate hostnames so
    // the two can be rate-limited and routed independently.
    export const Kind = z.enum(["app", "hooks"])
    export type  Kind = z.infer<typeof Kind>

    export const Schema = z.object({
        host:        z.string(),
        workspaceId: WorkspaceId,
        kind:        Kind,
        createdAt:   z.coerce.date(),
    })

    export const build = (subdomain: string, kind: Kind, domain: string) => `${subdomain}.${kind}.${domain}`
}
export type Hostname = z.infer<typeof Hostname.Schema>
