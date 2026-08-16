import { z } from "zod"
import { WorkspaceId } from "../Workspace/ids"

export namespace Machine {

    export const Id = z.uuid().brand("MachineId")
    export type  Id = z.infer<typeof Id>

    // Where the container runs. Everything else in provisioning is identical
    // across the two.
    export const Driver = z.enum(["docker", "fly"])
    export type  Driver = z.infer<typeof Driver>

    // 'combined' is the free-tier shape: one machine holding backend, Redis and
    // worker together.
    export const Role = z.enum(["backend", "worker", "combined"])
    export type  Role = z.infer<typeof Role>

    export const State = z.enum(["creating", "started", "stopped", "destroyed"])
    export type  State = z.infer<typeof State>

    export const Schema = z.object({
        id:          Id,
        workspaceId: WorkspaceId,
        driver:      Driver,
        // The driver's own handle: a Fly machine id, or a Docker container id.
        externalId:  z.string(),
        role:        Role,
        size:        z.string(),
        state:       State,
        lastBootAt:  z.coerce.date().nullable(),
        lastSeenAt:  z.coerce.date().nullable(),
        createdAt:   z.coerce.date(),
        updatedAt:   z.coerce.date(),
    })
}
export type Machine = z.infer<typeof Machine.Schema>
