import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';

/**
 * Where a workspace's containers run. Everything else in provisioning —
 * database, revoke, keygen, registry rows — is identical across implementations.
 */
export abstract class MachineDriver {

    abstract readonly kind: Fleet.Machine.Driver;

    /** Idempotent: returns the existing machine if `name` already exists. */
    abstract create(options: MachineDriver.CreateOptions): Promise<MachineDriver.Handle>;

    abstract start(externalId: Fleet.Machine.ExternalId): Promise<void>;

    abstract stop(externalId: Fleet.Machine.ExternalId): Promise<void>;

    /** Idempotent: succeeds when the machine is already gone. */
    abstract destroy(externalId: Fleet.Machine.ExternalId): Promise<void>;

    abstract status(externalId: Fleet.Machine.ExternalId): Promise<Fleet.Machine.State>;

    /** Whether the software inside is serving, as opposed to merely running. */
    abstract health(externalId: Fleet.Machine.ExternalId): Promise<MachineDriver.Health>;

    /** Everything this driver holds for a workspace, however it was labelled. */
    abstract findByWorkspace(workspaceId: Workspace.Id): Promise<MachineDriver.Handle[]>;
}

// Merged with the class above: types only, so nothing is emitted.
export namespace MachineDriver {

    export type CreateOptions = {
        workspaceId: Workspace.Id;
        /** Deterministic, derived from the workspace id, so a re-run finds this one. */
        name:        Fleet.Machine.Name;
        image:       string;
        role:        Fleet.Machine.Role;
        size:        string;
        env:         Record<string, string>;
    };

    // 'unknown' is an image that declares no check — it cannot be waited for.
    export type Health = 'starting' | 'healthy' | 'unhealthy' | 'unknown';

    /** What the driver hands back: its own id for the thing it made, and where it is. */
    export type Handle = {
        externalId: Fleet.Machine.ExternalId;
        state:      Fleet.Machine.State;
    };
}
