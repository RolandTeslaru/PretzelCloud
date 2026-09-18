import z from "zod";
import { WorkspaceId } from "../Workspace/ids";
import { Machine } from "./machine";
import { Driver as DriverMod } from "./driver";
import { Cluster as ClusterSchema } from "./cluster";
import { Region } from "./region";
import { Release } from "./release";

/**
 * A workspace's compute, agnostic to how many machines back it. One workspace
 * has exactly one hardware; the hardware has one or more machines (a combined
 * machine on free, a backend + worker split on paid, N workers when scaled).
 *
 * Operations a workspace names — restart, suspend — are hardware operations; the
 * hardware fans them out to its machines by role. Its machines carry the state
 * they last recorded; what they are doing right now is the driver's to say.
 */
export namespace Hardware {
    export const Id = z.uuid().brand("Fleet.Hardware.Id")
    export type  Id = z.infer<typeof Id>

    // One per hardware — a workspace never mixes a Docker backend with a Fly worker.
    export const Driver = DriverMod.Kind
    export type  Driver = DriverMod.Kind

    export const Schema = z.object({
        id:          Id,
        workspaceId: WorkspaceId,
        driver:      Driver,
        /** The Postgres cluster this workspace's database was created in. */
        clusterId:   ClusterSchema.Id,
        /** Where it lives: the cluster's region, and where its machines are placed. */
        region:      Region.Schema,
        /** The release its machines are built from. */
        releaseId:   Release.Id,
        /** The machines backing it, with the state each last recorded. */
        machines:    z.array(Machine.Schema),
        lastBootAt:  z.coerce.date().nullable(),
        lastSeenAt:  z.coerce.date().nullable(),
        createdAt:   z.coerce.date(),
        updatedAt:   z.coerce.date(),
    })
}
export type Hardware = z.infer<typeof Hardware.Schema>
