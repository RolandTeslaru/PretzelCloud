import z from "zod";
import { WorkspaceId } from "../Workspace/ids";
import { Machine } from "./machine";

/**
 * A workspace's compute, agnostic to how many machines back it. One workspace
 * has exactly one hardware; the hardware has one or more machines (a combined
 * machine on free, a backend + worker split on paid, N workers when scaled).
 *
 * Operations a workspace names — restart, suspend — are hardware operations; the
 * hardware fans them out to its machines by role. State is NOT stored here: a
 * machine's state is volatile and would go stale the moment it were copied up,
 * so it is read from the machines when asked.
 */
export namespace Hardware {
    export const Id = z.uuid().brand("Fleet.Hardware.Id")
    export type  Id = z.infer<typeof Id>

    // The substrate a workspace's machines all run on. One per hardware — a
    // workspace never mixes a Docker backend with a Fly worker.
    export const Driver = z.enum(["docker", "fly"])
    export type  Driver = z.infer<typeof Driver>

    export const Schema = z.object({
        id:          Id,
        workspaceId: WorkspaceId,
        driver:      Driver,
        // The machines backing it, by id. Ids are stable; their volatile state
        // is read fresh, never carried here.
        machineIds:  z.array(Machine.Id),
        lastBootAt:  z.coerce.date().nullable(),
        lastSeenAt:  z.coerce.date().nullable(),
        createdAt:   z.coerce.date(),
        updatedAt:   z.coerce.date(),
    })
}
export type Hardware = z.infer<typeof Hardware.Schema>
