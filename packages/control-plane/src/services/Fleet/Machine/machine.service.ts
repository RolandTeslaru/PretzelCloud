import { Injectable } from '@nestjs/common';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { Principal } from '@/auth/identity/principal';
import { AbstractHardwareDriver } from '../drivers/driver';
import { DriverRegistry } from '../drivers/driver.registry';
import { MachineRepository } from './machine.repository';

// Generous: the first boot of a workspace migrates its empty database.
const HEALTH_TIMEOUT_MS = 120_000;
const HEALTH_POLL_MS    = 1_000;

/**
 * One machine at a time: create it, drive its lifecycle, wait for it to serve.
 * The aggregate over a workspace's machines is Hardware — nothing here fans out.
 */
@Injectable()
export class MachineService {

    constructor(
        private readonly machineRepository: MachineRepository,
        private readonly driverRegistry:    DriverRegistry,
    ) {}

    /** Every machine row names its own substrate; nobody has to be told. */
    private driverFor(machine: Fleet.Machine): AbstractHardwareDriver {
        return this.driverRegistry.getDriverForKind(machine.driver);
    }

    /** The spec says which role this is, so nothing else has to be told. */
    async create(
        driverKind:  Fleet.Hardware.Driver,
        hardwareId:  Fleet.Hardware.Id,
        workspaceId: Workspace.Id,
        region:      Fleet.Region.Schema,
        spec:        Fleet.Machine.Spec,
    ): Promise<AbstractHardwareDriver.Handle> {
        const driver = this.driverRegistry.getDriverForKind(driverKind);

        const handle = await driver.create({
            workspaceId,
            region,
            name:  Fleet.Machine.Name.create(workspaceId, spec.role),
            role:  spec.role,
            image: spec.image,
            size:  spec.size,
            env:   spec.env,
        });

        await this.machineRepository.insert(Principal.SELF, {
            workspace_id: workspaceId,
            hardware_id:  hardwareId,
            driver:       driverKind,
            external_id:  handle.resourceId,
            role:         spec.role,
            size:         spec.size,
            state:        handle.state,
        });

        return handle;
    }

    getAll(workspaceId: Workspace.Id): Promise<Fleet.Machine[]> {
        return this.machineRepository.getAll(Principal.SELF, workspaceId);
    }

    /**
     * One machine by role, preferring the order given — `['backend',
     * 'combined']` finds a split's backend or the single machine standing in
     * for it. Reads one row rather than the whole set.
     */
    getByRole(workspaceId: Workspace.Id, roles: Fleet.Machine.Role[]): Promise<Fleet.Machine | undefined> {
        return this.machineRepository.getByRole(Principal.SELF, workspaceId, roles);
    }

    /** Blocks until this one machine reports serving, not merely started. */
    /** The driver's view, without recording it — for reads that must stay cheap. */
    getState(machine: Fleet.Machine): Promise<Fleet.Machine.State> {
        return this.driverFor(machine).status(machine.resourceId);
    }

    /** Whether the software inside is serving, as opposed to merely running. */
    health(machine: Fleet.Machine): Promise<AbstractHardwareDriver.Health> {
        return this.driverFor(machine).health(machine.resourceId);
    }

    async awaitHealthy(machine: Fleet.Machine, timeoutMs = HEALTH_TIMEOUT_MS): Promise<void> {
        const driver = this.driverFor(machine);

        const deadline = Date.now() + timeoutMs;

        for (;;) {
            const health = await driver.health(machine.resourceId);

            // An image declaring no check cannot be waited for; take it as ready.
            if (health === 'healthy' || health === 'unknown')
                return;

            // `unhealthy` is not terminal while there is still time: a machine
            // that has not opened its port yet fails a check exactly as one that
            // never will does, and only the deadline tells them apart.
            if (Date.now() > deadline)
                throw new Error(`Machine ${machine.resourceId} was ${health} for the whole ${timeoutMs}ms it was given`);

            await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS));
        }
    }

    /** Where to reach the machine, or null when it is not serving. */
    address(machine: Fleet.Machine): Promise<URL | null> {
        return this.driverFor(machine).address(machine.resourceId);
    }

    start(machine: Fleet.Machine): Promise<void> {
        return this.driverFor(machine).start(machine.resourceId);
    }

    stop(machine: Fleet.Machine): Promise<void> {
        return this.driverFor(machine).stop(machine.resourceId);
    }

    suspend(machine: Fleet.Machine): Promise<void> {
        return this.driverFor(machine).suspend(machine.resourceId);
    }

    resume(machine: Fleet.Machine): Promise<void> {
        return this.driverFor(machine).resume(machine.resourceId);
    }

    async restart(machine: Fleet.Machine): Promise<void> {
        const driver = this.driverFor(machine);

        await driver.stop(machine.resourceId);
        await driver.start(machine.resourceId);
    }

    /**
     * Destroys one machine — the substrate instance and its record.
     *
     * Refuses a live one. Removal is a kill: it would abandon the machine's
     * customer database connections and leave its job locked for the lease, so
     * stopping first is the caller's to do, and forgetting is a bug rather than
     * something to paper over here.
     */
    async destroy(machine: Fleet.Machine): Promise<void> {
        if (machine.state === 'running' || machine.state === 'suspended')
            throw new Error(`Machine ${machine.resourceId} is ${machine.state}; stop it before destroying it`);

        await this.driverFor(machine).destroy(machine.resourceId);

        await this.machineRepository.deleteById(Principal.SELF, machine.id);
    }

    /** Asks the driver, not the row: the daemon is the truth about what is running. */
    /** Records what the driver says, and hands it back to the caller. */
    async refreshState(machine: Fleet.Machine): Promise<Fleet.Machine.State> {
        const state = await this.driverFor(machine).status(machine.resourceId);

        await this.machineRepository.setState(Principal.SELF, machine.id, state);

        return state;
    }
}
