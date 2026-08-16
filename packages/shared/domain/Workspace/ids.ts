import { z } from "zod"

// Minted before the first write. Every provisioning step is keyed by it, which
// is what makes a killed run re-runnable.
export const WorkspaceId = z.uuid().brand("WorkspaceId")
export type  WorkspaceId = z.infer<typeof WorkspaceId>

export const createId = () => crypto.randomUUID() as WorkspaceId
