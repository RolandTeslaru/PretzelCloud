import { Workspace } from "./index"
import { Cluster } from "../Fleet/cluster"

/** What a workspace's plan implies for the infrastructure behind it. */
export namespace Provisioning {

    // Derived rather than stored, so nothing can drift and a workspace whose row
    // is lost is still locatable. Underscores: a uuid's dashes need quoting.
    const identifier = (id: Workspace.Id) => id.replace(/-/g, '')

    export const getDatabaseName = (id: Workspace.Id) =>
        Cluster.Database.Name.parse(`wspace_${identifier(id)}`)

    export const getRoleName = (id: Workspace.Id) =>
        Cluster.Role.Name.parse(`wspace_role_${identifier(id)}`)
}
