import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';

/**
 * Where a workspace's containers run. Everything else in provisioning —
 * database, revoke, keygen, registry rows — is identical across implementations.
 */
export abstract class AbstractHardwareDriver {

    abstract readonly kind: Fleet.Hardware.Driver;

    /** Idempotent: returns the existing machine if `name` already exists. */
    abstract create(options: AbstractHardwareDriver.CreateOptions): Promise<AbstractHardwareDriver.Handle>;

    abstract start(externalId: Fleet.Machine.ExternalId): Promise<void>;

    abstract stop(externalId: Fleet.Machine.ExternalId): Promise<void>;

    /**
     * Freezes the machine in place — memory kept, nothing scheduled — so that
     * `resume` continues it without a boot. Cheaper to wake than `stop`, and
     * the machine's own connections go stale while it is frozen.
     */
    abstract suspend(externalId: Fleet.Machine.ExternalId): Promise<void>;

    abstract resume(externalId: Fleet.Machine.ExternalId): Promise<void>;

    /** Idempotent: succeeds when the machine is already gone. */
    abstract destroy(externalId: Fleet.Machine.ExternalId): Promise<void>;

    abstract status(externalId: Fleet.Machine.ExternalId): Promise<Fleet.Machine.State>;

    /** Whether the software inside is serving, as opposed to merely running. */
    abstract health(externalId: Fleet.Machine.ExternalId): Promise<AbstractHardwareDriver.Health>;

    /** Everything this driver holds for a workspace, however it was labelled. */
    abstract findByWorkspace(workspaceId: Workspace.Id): Promise<AbstractHardwareDriver.Handle[]>;

    /**
     * Where to reach the machine from inside the fleet. Every platform gives its
     * own private addressing — a container name, an internal DNS record — so the
     * driver answers and nothing above it learns which platform it is on.
     *
     * Null when the machine is not currently reachable, which is a stopped
     * machine rather than an error.
     */
    abstract address(externalId: Fleet.Machine.ExternalId): Promise<URL | null>;
}

// Merged with the class above: types only, so nothing is emitted.
export namespace AbstractHardwareDriver {

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
