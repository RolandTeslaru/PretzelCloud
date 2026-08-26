import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';

/**
 * Where a workspace's containers run. Everything else in provisioning —
 * database, revoke, keygen, registry rows — is identical across implementations.
 */
export abstract class AbstractHardwareDriver {

    abstract readonly kind: Fleet.Hardware.Driver;

    /** Idempotent: returns the existing machine if `name` already exists. */
    abstract create(options: AbstractHardwareDriver.CreateOptions): Promise<AbstractHardwareDriver.Handle>;

    abstract start(resourceId: Fleet.Machine.ResourceId): Promise<void>;

    abstract stop(resourceId: Fleet.Machine.ResourceId): Promise<void>;

    /**
     * Freezes the machine in place — memory kept, nothing scheduled — so that
     * `resume` continues it without a boot. Cheaper to wake than `stop`, and
     * the machine's own connections go stale while it is frozen.
     */
    abstract suspend(resourceId: Fleet.Machine.ResourceId): Promise<void>;

    abstract resume(resourceId: Fleet.Machine.ResourceId): Promise<void>;

    /** Idempotent: succeeds when the machine is already gone. */
    abstract destroy(resourceId: Fleet.Machine.ResourceId): Promise<void>;

    abstract status(resourceId: Fleet.Machine.ResourceId): Promise<Fleet.Machine.State>;

    /** Whether the software inside is serving, as opposed to merely running. */
    abstract health(resourceId: Fleet.Machine.ResourceId): Promise<AbstractHardwareDriver.Health>;

    /** Everything this driver holds for a workspace, however it was labelled. */
    abstract findByWorkspace(workspaceId: Workspace.Id): Promise<AbstractHardwareDriver.Handle[]>;

    /**
     * Whatever a workspace holds besides its machines — a network of its own on
     * one platform, nothing at all on another. Called once the machines are gone.
     */
    abstract destroyScope(workspaceId: Workspace.Id): Promise<void>;

    /**
     * The host one machine reaches a sibling at, from inside the fleet. Not the
     * same question as `address`, which answers how the router reaches it from
     * outside — on some platforms those have different answers.
     *
     * Which of a machine's identifiers is routable is the driver's to know, so
     * the resource id is all it is given and the lookup is its own.
     */
    abstract getInternalHostForMachine(resourceId: Fleet.Machine.ResourceId): Promise<string>;

    /**
     * Where to reach the machine from inside the fleet. Every platform gives its
     * own private addressing — a container name, an internal DNS record — so the
     * driver answers and nothing above it learns which platform it is on.
     *
     * Null when the machine is not currently reachable, which is a stopped
     * machine rather than an error.
     */
    abstract address(resourceId: Fleet.Machine.ResourceId): Promise<URL | null>;
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
        resourceId: Fleet.Machine.ResourceId;
        state:      Fleet.Machine.State;
    };
}
