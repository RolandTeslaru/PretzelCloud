import { z } from "zod"
import { WorkspaceId } from "../Workspace/ids"

// Read by one caller — the provisioner, handing these to a machine. Never
// returned to a controller, never logged, never widened into a DTO.
export namespace WorkspaceSecrets {

    export const Schema = z.object({
        workspaceId:   WorkspaceId,
        databaseUrl:   z.string(),
        encryptionKey: z.string(),
        createdAt:     z.coerce.date(),
        updatedAt:     z.coerce.date(),
    })

    // Exactly what a machine receives as its environment. The only shape these
    // values are allowed to leave the provisioner in.
    export const MachineEnv = z.object({
        DATABASE_URL:           z.string(),
        // The workspace derives the key's id from the key itself.
        PRETZEL_ENCRYPTION_KEY: z.string(),
        WORKSPACE_ID:           WorkspaceId,
    })
    export type MachineEnv = z.infer<typeof MachineEnv>
}
export type WorkspaceSecrets = z.infer<typeof WorkspaceSecrets.Schema>
