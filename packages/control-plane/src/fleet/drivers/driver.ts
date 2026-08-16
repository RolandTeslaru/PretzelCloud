import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';

export type CreateOptions = {
    workspaceId: Workspace.Id;
    /** Deterministic, derived from the workspace id, so a re-run finds this one. */
    name:        string;
    image:       string;
    role:        Fleet.Machine.Role;
    size:        string;
    env:         Record<string, string>;
};

export type MachineHandle = {
    externalId: string;
    state:      Fleet.Machine.State;
};

/**
 * Where a workspace's containers run. Everything else in provisioning —
 * database, revoke, keygen, registry rows — is identical across implementations.
 */
export abstract class MachineDriver {

    abstract readonly kind: Fleet.Machine.Driver;

    /** Idempotent: returns the existing machine if `name` already exists. */
    abstract create(options: CreateOptions): Promise<MachineHandle>;

    abstract start(externalId: string): Promise<void>;

    abstract stop(externalId: string): Promise<void>;

    /** Idempotent: succeeds when the machine is already gone. */
    abstract destroy(externalId: string): Promise<void>;

    abstract status(externalId: string): Promise<Fleet.Machine.State>;

    /** Everything this driver holds for a workspace, however it was labelled. */
    abstract findByWorkspace(workspaceId: Workspace.Id): Promise<MachineHandle[]>;
}
