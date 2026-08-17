import * as ClusterMod from "./cluster"
import * as MachineMod from "./machine"
import * as SecretsMod from "./secrets"
import * as HostnameMod from "./hostname"
import * as RuntimeMod from "./runtime"

// Actual state: what has been materialized for a workspace. Desired state is
// Workspace, in the portal database. Nothing here can reference it — separate
// databases, separate credentials — so these rows can outlive the workspace
// they name, and the reconciler sweeps both directions.
export namespace Fleet {

    export import Cluster          = ClusterMod.Cluster
    export import Machine          = MachineMod.Machine
    export import WorkspaceSecrets = SecretsMod.WorkspaceSecrets
    export import Hostname         = HostnameMod.Hostname
    export import WorkspaceRuntime = RuntimeMod.WorkspaceRuntime
}
