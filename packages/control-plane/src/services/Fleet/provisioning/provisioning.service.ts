import { Injectable, Logger } from '@nestjs/common';
import { Fleet, User, Workspace } from '@pretzel-cloud/shared/domain';
import { ClusterService } from '../cluster/cluster.service';
import { FleetService } from '../fleet.service';
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

    async provision(workspaceId: Workspace.Id, owner: User): Promise<void> {
        // The workspace decides what its database and role are called; the
        // cluster service only creates what it is told to.
        const spec = {
            databaseName: Workspace.getDatabaseName(workspaceId),
            roleName:     Workspace.getRoleName(workspaceId),
        };

        const databaseUrl = await this.step('database', () => this.cluster.createDatabase(spec));

        await this.step('secrets', () => this.fleet.ensureSecrets(workspaceId, databaseUrl));

        const env = await this.step('secrets', () => this.fleet.machineEnv(workspaceId));

        if (!env)
            throw new ProvisioningError('secrets', 'no secrets after writing them');

        await this.step('machine', () => this.fleet.createMachine(workspaceId, 'combined', {
            image: requireEnv('WORKSPACE_IMAGE'),
            size:  process.env.WORKSPACE_SIZE ?? 'shared-1x-512',
            env:   {
                ...env,
                // The issuer as reached from inside the container, not the URL a
                // browser is given.
                AUTH_URL:        requireEnv('WORKSPACE_AUTH_URL'),
                // Tokens are verified locally against the fleet issuer's secret.
                AUTH_JWT_SECRET: requireEnv('AUTH_JWT_SECRET'),
                // Names the owner up front, so ownership is not won by arriving first.
                WORKSPACE_OWNER_ID: owner.id,
                // The origin a browser reaches this workspace at.
                CORS_ORIGIN: Fleet.Hostname.Host.getOrigin(Workspace.Subdomain.canonical(workspaceId), 'app'),
            },
        }));

        // Before hostnames: a machine that never serves should not be published.
        await this.step('health', () => this.fleet.awaitHealthy(workspaceId));

        // After health, which is what says the workspace has run its migrations.
        await this.step('owner', () => this.cluster.seedOwner(spec.databaseName, owner));

        await this.step('hostnames', () => this.fleet.registerCanonicalHostnames(workspaceId));

        this.logger.log(`Provisioned ${workspaceId}`);
    }

    /** Destroys what exists. Safe to call against a workspace that never got far. */
    async deprovision(workspaceId: Workspace.Id): Promise<void> {
        await this.fleet.teardown(workspaceId);

        await this.cluster.dropDatabase({
            databaseName: Workspace.getDatabaseName(workspaceId),
            roleName:     Workspace.getRoleName(workspaceId),
        });
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
