import { z } from "zod"
import { WorkspaceId } from "../Workspace/ids"
import { Cluster } from "./cluster"

// Read by one caller — the provisioner, handing these to a machine. Never
// returned to a controller, never logged, never widened into a DTO.
export namespace WorkspaceSecrets {

    export const Schema = z.object({
        workspaceId:   WorkspaceId,
        databaseUrl:   Cluster.Database.ConnectionURL,
        encryptionKey: z.string(),
        createdAt:     z.coerce.date(),
        updatedAt:     z.coerce.date(),
    })

    // Exactly what a machine receives as its environment. The only shape these
    // values are allowed to leave the provisioner in.
    export const MachineEnv = z.object({
        DATABASE_URL:           Cluster.Database.ConnectionURL,
        // The workspace derives the key's id from the key itself.
        PRETZEL_ENCRYPTION_KEY: z.string(),
        // Read lazily by the workspace, so a missing value surfaces at the first
        // execution rather than at boot.
        EXECUTION_TOKEN_SIGNING_KEY: z.string(),
        WORKSPACE_ID:           WorkspaceId,
        // Required on traffic reaching the workspace, when it fronts itself
        // with a proxy that stamps it.
        TRUSTED_PROXY_TOKEN:    z.string(),
    })
    export type MachineEnv = z.infer<typeof MachineEnv>
}
export type WorkspaceSecrets = z.infer<typeof WorkspaceSecrets.Schema>
