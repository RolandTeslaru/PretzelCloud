import { Injectable, Logger } from '@nestjs/common';
import { Workspace } from '@pretzel-cloud/shared/domain';
import { ClusterService } from './cluster.service';
import { FleetService } from './fleet.service';
import { requireEnv } from '@/db/table';

export class ProvisioningError extends Error {
    constructor(readonly step: string, cause: unknown) {
        super(`Provisioning failed at ${step}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
}

/**
 * Materializes a workspace. The caller has already written the intent — a
 * `workspaces` row and its owner — so every step here is re-runnable under the
 * same id and no-ops until it reaches the one that did not finish.
 *
 * Nothing unwinds on failure. The caller decides whether to retry or tear down.
 */
@Injectable()
export class ProvisioningService {

    private readonly logger = new Logger(ProvisioningService.name);

    constructor(
        private readonly cluster: ClusterService,
        private readonly fleet: FleetService,
    ) {}

    async provision(workspaceId: Workspace.Id): Promise<void> {
        const databaseUrl = await this.step('database', () => this.cluster.createDatabase(workspaceId));

        await this.step('secrets', () => this.fleet.ensureSecrets(workspaceId, databaseUrl));

        const env = await this.step('secrets', () => this.fleet.machineEnv(workspaceId));

        if (!env)
            throw new ProvisioningError('secrets', 'no secrets after writing them');

        await this.step('machine', () => this.fleet.createMachine(workspaceId, 'combined', {
            image: requireEnv('WORKSPACE_IMAGE'),
            size:  process.env.WORKSPACE_SIZE ?? 'shared-1x-512',
            env:   { ...env, AUTH_URL: requireEnv('AUTH_URL') },
        }));

        await this.step('hostnames', () => this.fleet.registerCanonicalHostnames(workspaceId));

        this.logger.log(`Provisioned ${workspaceId}`);
    }

    /** Destroys what exists. Safe to call against a workspace that never got far. */
    async deprovision(workspaceId: Workspace.Id): Promise<void> {
        await this.fleet.teardown(workspaceId);
        await this.cluster.dropDatabase(workspaceId);
    }

    private async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
        try {
            return await fn();
        }
        catch (cause) {
            throw new ProvisioningError(name, cause);
        }
    }
}
