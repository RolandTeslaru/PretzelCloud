import { z } from "zod"
import { WorkspaceId } from "../Workspace/ids"

/**
 * Three identifiers, because three parties name a machine at three different
 * times:
 *
 *   Name        ours, derived from the workspace — known before anything exists
 *   ExternalId  the driver's, handed back by create — known only after
 *   Id          this table's own row key — assigned on insert, last of all
 *
 * The name is what makes provisioning re-runnable: a run killed between `create`
 * and the insert left no record of the external id, so the only way to find what
 * it made is to ask for it by a name we can derive again.
 */
export namespace Machine {

    export const Id = z.uuid().brand("Fleet.Machine.Id")
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

    /** The driver's own handle: a Fly machine id, or a Docker container id. */
    export const ExternalId = z.string().min(1).brand("Fleet.Machine.ExternalId")
    export type  ExternalId = z.infer<typeof ExternalId>

    export namespace Name {

        // Hyphens rather than the underscores Postgres identifiers need — this
        // one names a container, not a database.
        export const Schema = z.string()
            .regex(/^wspace-[0-9a-f-]{36}-(backend|worker|combined)$/)
            .brand("Fleet.Machine.Name")

        export const create = (workspaceId: WorkspaceId, role: Role) =>
            Schema.parse(`wspace-${workspaceId}-${role}`)
    }
    export type Name = z.infer<typeof Name.Schema>

    export const Schema = z.object({
        id:          Id,
        workspaceId: WorkspaceId,
        driver:      Driver,
        externalId:  ExternalId,
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
