import { Injectable, Logger } from '@nestjs/common';
import { Fleet, User, Workspace } from '@pretzel-cloud/shared/domain';
import { ClusterService } from '../cluster/cluster.service';
import { WorkspaceSecretsService } from '../WorkspaceSecrets/workspace-secrets.service';
import { HardwareService } from '../Hardware/hardware.service';
import { HostnameService } from '../Hostname/hostname.service';
import { requireEnv } from '@/db/table';
import { WorkspaceTokenIssuer } from '@/services/WorkspaceSession/token-issuer.service';

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
        private readonly cluster:  ClusterService,
        private readonly secrets:  WorkspaceSecretsService,
        private readonly hardware: HardwareService,
        private readonly hostnames: HostnameService,
        private readonly workspaceTokenIssuer: WorkspaceTokenIssuer,
    ) {}

    async provision(workspaceId: Workspace.Id, owner: User, plan: Workspace.Plan): Promise<void> {
        // The workspace decides what its database and role are called; the
        // cluster service only creates what it is told to.
        const spec = {
            databaseName: Workspace.getDatabaseName(workspaceId),
            roleName:     Workspace.getRoleName(workspaceId),
        };

        const databaseUrl = await this.step('database', () => this.cluster.createDatabase(spec));

        await this.step('secrets', () => this.secrets.ensure(workspaceId, databaseUrl));

        const env = await this.step('secrets', () => this.secrets.get(workspaceId));

        if (!env)
            throw new ProvisioningError('secrets', 'no secrets after writing them');

        const specInputs = await this.specInputs(workspaceId, owner.id, env);

        await this.step('hardware', () => this.hardware.build(workspaceId, plan, specInputs));

        // Before hostnames: a machine that never serves should not be published.
        await this.step('health', () => this.hardware.awaitHealthy(workspaceId));

        // After health, which is what says the workspace has run its migrations.
        await this.step('owner', () => this.cluster.seedOwner(spec.databaseName, owner));

        await this.step('hostnames', () => this.hostnames.registerCanonical(workspaceId));

        this.logger.log(`Provisioned ${workspaceId}`);
    }

    /**
     * Moves a workspace's compute to a different plan's topology. The machines
     * are rebuilt to match; the database is in the cluster, so nothing it holds
     * is touched.
     */
    async convert(workspaceId: Workspace.Id, ownerId: User.Id, plan: Workspace.Plan): Promise<void> {
        const env = await this.secrets.get(workspaceId);

        if (!env)
            throw new ProvisioningError('secrets', 'no secrets for this workspace');

        const specInputs = await this.specInputs(workspaceId, ownerId, env);

        // No health wait here: the caller stops the hardware around a conversion
        // and starts it after, so nothing is serving until it does.
        await this.step('convert', () => this.hardware.convertTo(workspaceId, plan, specInputs));
    }

    /** Rebuilds a workspace's machines from the current spec, keeping its data. */
    async rebuild(workspaceId: Workspace.Id, ownerId: User.Id, plan: Workspace.Plan): Promise<void> {
        const env = await this.secrets.get(workspaceId);

        if (!env)
            throw new ProvisioningError('secrets', 'no secrets for this workspace');

        const specInputs = await this.specInputs(workspaceId, ownerId, env);

        // No health wait here: the caller stops the hardware around a rebuild
        // and starts it after, so nothing is serving until it does.
        await this.step('rebuild', () => this.hardware.rebuild(workspaceId, plan, specInputs));
    }

    /**
     * What a machine is built from, shared by the first build and later
     * conversions. Which image and size each role runs is the hardware's own
     * decision, so nothing here names one.
     */
    private async specInputs(
        workspaceId: Workspace.Id,
        ownerId:     User.Id,
        env:         Fleet.WorkspaceSecrets.MachineEnv,
    ): Promise<Fleet.Machine.Spec.Inputs> {
        return {
            ownerId,
            cloudToken: await this.secrets.getCloudToken(workspaceId) ?? '',
            secrets:      env,
            authUrl:      requireEnv('WORKSPACE_AUTH_URL'),
            tokenIssuer:  this.workspaceTokenIssuer.issuer(),
            publicKey:    JSON.stringify(await this.workspaceTokenIssuer.publicJwk()),
            appOrigin:    Fleet.Hostname.Host.getOrigin(Workspace.Subdomain.canonical(workspaceId), 'app'),
            cloudUrl:     requireEnv('PRETZEL_CLOUD_URL'),
        };
    }

    /** Destroys what exists. Safe to call against a workspace that never got far. */
    async deprovision(workspaceId: Workspace.Id): Promise<void> {
        // Stopped before removed: removal is a kill, and a killed machine
        // abandons its customer database connections instead of closing them.
        await this.hardware.stopAll(workspaceId);
        await this.hardware.destroy(workspaceId);
        await this.hostnames.delete(workspaceId);
        await this.secrets.delete(workspaceId);

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
