import * as ClusterMod from "./cluster"
import * as MachineMod from "./machine"
import * as HardwareMod from "./hardware"
import * as SiloSecretsMod from "./silo-secrets"
import * as HostnameMod from "./hostname"
import * as DriverMod from "./driver"
import * as ReleaseMod from "./release"

// Actual state: what has been materialized for a workspace. Desired state is
// Workspace, in the portal database. Nothing here can reference it — separate
// databases, separate credentials — so these rows can outlive the workspace
// they name, and the reconciler sweeps both directions.
export namespace Fleet {

    export import Cluster          = ClusterMod.Cluster
    export import Machine          = MachineMod.Machine
    export import Hardware         = HardwareMod.Hardware
    export import SiloSecrets      = SiloSecretsMod.SiloSecrets
    export import Hostname         = HostnameMod.Hostname
    export import Driver           = DriverMod.Driver
    export import Release          = ReleaseMod.Release
}
