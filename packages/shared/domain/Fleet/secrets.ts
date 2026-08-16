import { z } from "zod"
import { WorkspaceId } from "../Workspace/ids"

// Read by one caller — the provisioner, handing these to a machine. Never
// returned to a controller, never logged, never widened into a DTO.
export namespace WorkspaceSecrets {

    export const Schema = z.object({
        workspace_id:      WorkspaceId,
        database_url:      z.string(),
        // Written into every blob the workspace encrypts, so a rotation can tell
        // which key produced which ciphertext.
        encryption_key_id: z.string(),
        encryption_key:    z.string(),
        created_at:        z.coerce.date(),
        updated_at:        z.coerce.date(),
    })

    // Exactly what a machine receives as its environment. The only shape these
    // values are allowed to leave the provisioner in.
    export const MachineEnv = z.object({
        DATABASE_URL:            z.string(),
        PRETZEL_ENCRYPTION_KEY:  z.string(),
        PRETZEL_ENCRYPTION_KEY_ID: z.string(),
        WORKSPACE_ID:            WorkspaceId,
    })
    export type MachineEnv = z.infer<typeof MachineEnv>
}
export type WorkspaceSecrets = z.infer<typeof WorkspaceSecrets.Schema>
