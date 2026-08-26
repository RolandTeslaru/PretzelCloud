import { Injectable } from '@nestjs/common';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { FleetDB } from '@/db/fleet';
import { AbstractHardwareDriver } from '../drivers/driver';
import { MachineDatabase } from './machine.database';

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
        private readonly db: MachineDatabase,
    ) {}

    /** The spec says which role this is, so nothing else has to be told. */
    async create(
        driver:      AbstractHardwareDriver,
        hardwareId:  Fleet.Hardware.Id,
        workspaceId: Workspace.Id,
        spec:        Fleet.Machine.Spec,
    ): Promise<AbstractHardwareDriver.Handle> {
        const handle = await driver.create({
            workspaceId,
            name:  Fleet.Machine.Name.create(workspaceId, spec.role),
            role:  spec.role,
            image: spec.image,
            size:  spec.size,
            env:   spec.env,
        });

        await FleetDB.asService('record machine', (trx) => this.db.insert(trx, {
            workspace_id: workspaceId,
            hardware_id:  hardwareId,
            driver:       driver.kind,
            external_id:  handle.resourceId,
            role:         spec.role,
            size:         spec.size,
            state:        handle.state,
        }));

        return handle;
    }

    getAll(workspaceId: Workspace.Id): Promise<Fleet.Machine[]> {
        return FleetDB.asService('list machines', (trx) => this.db.getAll(trx, workspaceId));
    }

    /**
     * One machine by role, preferring the order given — `['backend',
     * 'combined']` finds a split's backend or the single machine standing in
     * for it. Reads one row rather than the whole set.
     */
    getByRole(workspaceId: Workspace.Id, roles: Fleet.Machine.Role[]): Promise<Fleet.Machine | undefined> {
        return FleetDB.asService('read machine by role', (trx) => this.db.getByRole(trx, workspaceId, roles));
    }

    /** Blocks until this one machine reports serving, not merely started. */
    /** The driver's view, without recording it — for reads that must stay cheap. */
    getState(driver: AbstractHardwareDriver, resourceId: Fleet.Machine.ResourceId): Promise<Fleet.Machine.State> {
        return driver.status(resourceId);
    }

    /** Whether the software inside is serving, as opposed to merely running. */
    health(driver: AbstractHardwareDriver, resourceId: Fleet.Machine.ResourceId): Promise<AbstractHardwareDriver.Health> {
        return driver.health(resourceId);
    }

    async awaitHealthy(driver: AbstractHardwareDriver, resourceId: Fleet.Machine.ResourceId, timeoutMs = HEALTH_TIMEOUT_MS): Promise<void> {
        const deadline = Date.now() + timeoutMs;

        for (;;) {
            const health = await driver.health(resourceId);

            if (health === 'unhealthy')
                throw new Error(`Machine ${resourceId} failed its health check`);

            // An image declaring no check cannot be waited for; take it as ready.
            if (health === 'healthy' || health === 'unknown')
                return;

            if (Date.now() > deadline)
                throw new Error(`Machine ${resourceId} did not become healthy within ${timeoutMs}ms`);

            await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS));
        }
    }

    /** Where to reach the machine, or null when it is not serving. */
    address(driver: AbstractHardwareDriver, resourceId: Fleet.Machine.ResourceId): Promise<URL | null> {
        return driver.address(resourceId);
    }

    start(driver: AbstractHardwareDriver, resourceId: Fleet.Machine.ResourceId): Promise<void> {
        return driver.start(resourceId);
    }

    stop(driver: AbstractHardwareDriver, resourceId: Fleet.Machine.ResourceId): Promise<void> {
        return driver.stop(resourceId);
    }

    suspend(driver: AbstractHardwareDriver, resourceId: Fleet.Machine.ResourceId): Promise<void> {
        return driver.suspend(resourceId);
    }

    resume(driver: AbstractHardwareDriver, resourceId: Fleet.Machine.ResourceId): Promise<void> {
        return driver.resume(resourceId);
    }

    async restart(driver: AbstractHardwareDriver, resourceId: Fleet.Machine.ResourceId): Promise<void> {
        await driver.stop(resourceId);
        await driver.start(resourceId);
    }

    /**
     * Destroys one machine — the substrate instance and its record.
     *
     * Refuses a live one. Removal is a kill: it would abandon the machine's
     * customer database connections and leave its job locked for the lease, so
     * stopping first is the caller's to do, and forgetting is a bug rather than
     * something to paper over here.
     */
    async destroy(driver: AbstractHardwareDriver, machine: Fleet.Machine): Promise<void> {
        if (machine.state === 'running' || machine.state === 'suspended')
            throw new Error(`Machine ${machine.resourceId} is ${machine.state}; stop it before destroying it`);

        await driver.destroy(machine.resourceId);

        await FleetDB.asService('delete machine', (trx) => this.db.deleteById(trx, machine.id));
    }

    /** Asks the driver, not the row: the daemon is the truth about what is running. */
    /** Records what the driver says, and hands it back to the caller. */
    async refreshState(driver: AbstractHardwareDriver, machine: Fleet.Machine): Promise<Fleet.Machine.State> {
        const state = await driver.status(machine.resourceId);

        await FleetDB.asService('refresh machine state', (trx) => this.db.setState(trx, machine.id, state));

        return state;
    }
}
