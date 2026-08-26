import { Workspace } from "./index"
import { Cluster } from "../Fleet/cluster"
import { Machine } from "../Fleet/machine"

/** What a workspace's plan implies for the infrastructure behind it. */
export namespace Provisioning {

    // Derived rather than stored, so nothing can drift and a workspace whose row
    // is lost is still locatable. Underscores: a uuid's dashes need quoting.
    const identifier = (id: Workspace.Id) => id.replace(/-/g, '')

    export const getDatabaseName = (id: Workspace.Id) =>
        Cluster.Database.Name.parse(`wspace_${identifier(id)}`)

    export const getRoleName = (id: Workspace.Id) =>
        Cluster.Role.Name.parse(`wspace_role_${identifier(id)}`)

    /**
     * The machines a plan's compute is made of. Free runs one — it has a booting
     * screen by design — and paid splits, so the worker sits on a usage clock.
     */
    export const getMachineRoles = (plan: Workspace.Plan): Machine.Role[] =>
        Workspace.isPaid(plan) ? ["backend", "worker"] : ["combined"]

    /** What becomes of an idle workspace. Free freezes; staying up is what paid buys. */
    export const getIdlePolicy = (plan: Workspace.Plan): "suspend" | "none" =>
        Workspace.isPaid(plan) ? "none" : "suspend"
}
