import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';

/** Platform-specific machine operations for a workspace. */
export abstract class AbstractHardwareDriver {

    abstract readonly kind: Fleet.Hardware.Driver;

    /** Idempotent: returns the existing machine if `name` already exists. */
    abstract create(options: AbstractHardwareDriver.CreateOptions): Promise<AbstractHardwareDriver.Handle>;

    abstract start(resourceId: Fleet.Machine.ResourceId): Promise<void>;

    abstract stop(resourceId: Fleet.Machine.ResourceId): Promise<void>;

    /** Freezes the machine with memory kept; `resume` continues it without a boot. */
    abstract suspend(resourceId: Fleet.Machine.ResourceId): Promise<void>;

    abstract resume(resourceId: Fleet.Machine.ResourceId): Promise<void>;

    /** Idempotent: succeeds when the machine is already gone. */
    abstract destroy(resourceId: Fleet.Machine.ResourceId): Promise<void>;

    abstract status(resourceId: Fleet.Machine.ResourceId): Promise<Fleet.Machine.State>;

    /** Current resource use; null when the machine is not running. */
    abstract statistics(resourceId: Fleet.Machine.ResourceId): Promise<AbstractHardwareDriver.Statistics | null>;

    /** Whether the software inside is serving. */
    abstract health(resourceId: Fleet.Machine.ResourceId): Promise<AbstractHardwareDriver.Health>;

    /** Every machine this driver holds for a workspace. */
    abstract findByWorkspace(workspaceId: Workspace.Id): Promise<AbstractHardwareDriver.Handle[]>;

    /** Removes the workspace's non-machine resources; called after its machines are gone. */
    abstract destroyScope(workspaceId: Workspace.Id): Promise<void>;

    /** Host a sibling machine reaches this one at from inside the fleet. */
    abstract getInternalHostForMachine(resourceId: Fleet.Machine.ResourceId): Promise<string>;

    /** Internal URL of the machine; null when it is not reachable. */
    abstract address(resourceId: Fleet.Machine.ResourceId): Promise<URL | null>;
}




export namespace AbstractHardwareDriver {

    export type CreateOptions = {
        workspaceId: Workspace.Id;
        name:        Fleet.Machine.Name;
        image:       string;
        role:        Fleet.Machine.Role;
        size:        string;
        env:         Record<string, string>;
    };




    /** 'unknown' means the image declares no health check. */
    export type Health = 'starting' | 'healthy' | 'unhealthy' | 'unknown';




    export type Statistics = {
        cpuPercent:    number;
        memUsedBytes:  number;
        memTotalBytes: number;
    };




    export type Handle = {
        resourceId: Fleet.Machine.ResourceId;
        state:      Fleet.Machine.State;
    };
}
