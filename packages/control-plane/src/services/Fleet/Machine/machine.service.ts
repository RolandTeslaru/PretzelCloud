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
        private readonly driver: AbstractHardwareDriver,
        private readonly db:     MachineDatabase,
    ) {}

    async create(
        hardwareId:  Fleet.Hardware.Id,
        workspaceId: Workspace.Id,
        role:        Fleet.Machine.Role,
        options:     { image: string; size: string; env: Record<string, string> },
    ): Promise<void> {
        const handle = await this.driver.create({
            workspaceId,
            name:  Fleet.Machine.Name.create(workspaceId, role),
            role,
            image: options.image,
            size:  options.size,
            env:   options.env,
        });

        await FleetDB.asService('record machine', (trx) => this.db.insert(trx, {
            workspace_id: workspaceId,
            hardware_id:  hardwareId,
            external_id:  handle.externalId,
            role,
            size:         options.size,
            state:        handle.state,
        }));
    }

    listFor(workspaceId: Workspace.Id): Promise<Fleet.Machine[]> {
        return FleetDB.asService('list machines', (trx) => this.db.listByWorkspace(trx, workspaceId));
    }

    /** Blocks until this one machine reports serving, not merely started. */
    async awaitHealthy(externalId: Fleet.Machine.ExternalId, timeoutMs = HEALTH_TIMEOUT_MS): Promise<void> {
        const deadline = Date.now() + timeoutMs;

        for (;;) {
            const health = await this.driver.health(externalId);

            if (health === 'unhealthy')
                throw new Error(`Machine ${externalId} failed its health check`);

            // An image declaring no check cannot be waited for; take it as ready.
            if (health === 'healthy' || health === 'unknown')
                return;

            if (Date.now() > deadline)
                throw new Error(`Machine ${externalId} did not become healthy within ${timeoutMs}ms`);

            await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS));
        }
    }

    /** Where to reach the machine, or null when it is not serving. */
    address(externalId: Fleet.Machine.ExternalId): Promise<URL | null> {
        return this.driver.address(externalId);
    }

    start(externalId: Fleet.Machine.ExternalId): Promise<void> {
        return this.driver.start(externalId);
    }

    stop(externalId: Fleet.Machine.ExternalId): Promise<void> {
        return this.driver.stop(externalId);
    }

    suspend(externalId: Fleet.Machine.ExternalId): Promise<void> {
        return this.driver.suspend(externalId);
    }

    resume(externalId: Fleet.Machine.ExternalId): Promise<void> {
        return this.driver.resume(externalId);
    }

    async restart(externalId: Fleet.Machine.ExternalId): Promise<void> {
        await this.driver.stop(externalId);
        await this.driver.start(externalId);
    }

    /** Destroys one machine — the substrate instance and its record. */
    async destroy(machine: Fleet.Machine): Promise<void> {
        await this.driver.destroy(machine.externalId);

        await FleetDB.asService('delete machine', (trx) => this.db.deleteById(trx, machine.id));
    }

    /** Asks the driver, not the row: the daemon is the truth about what is running. */
    async refreshState(machine: Fleet.Machine): Promise<void> {
        const state = await this.driver.status(machine.externalId);

        await FleetDB.asService('refresh machine state', (trx) => this.db.setState(trx, machine.id, state));
    }
}
