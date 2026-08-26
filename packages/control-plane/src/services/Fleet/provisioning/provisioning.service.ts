import { Injectable, Logger } from '@nestjs/common';
import { Fleet, User, Workspace } from '@pretzel-cloud/shared/domain';
import { Provisioning } from '@pretzel-cloud/shared/domain/Workspace/provisioning';
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

/** Materializes an already-written workspace; every step re-runs under the same id and nothing unwinds on failure. */
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
        // The workspace names its database and role; the cluster only creates what it is told.
        const databaseName = Provisioning.getDatabaseName(workspaceId);
        const dbRoleName   = Provisioning.getRoleName(workspaceId);

        const databaseUrl = await this.step('database', () => this.cluster.createDatabase(databaseName, dbRoleName));

        await this.step('secrets', () => this.secrets.ensure(workspaceId, databaseUrl));

        const secrets = await this.step('secrets', () => this.secrets.get(workspaceId));

        if (!secrets)
            throw new ProvisioningError('secrets', 'no secrets after writing them');

        const { baseEnvKeys, backendEnvKeys } = await this.getMachineEnvKeys(workspaceId, owner.id, secrets);

        await this.step('hardware', () => this.hardware.build(workspaceId, plan, baseEnvKeys, backendEnvKeys));

        // Before hostnames: a machine that never serves should not be published.
        await this.step('health', () => this.hardware.awaitHealthy(workspaceId));

        // After health, which is what says the workspace has run its migrations.
        await this.step('owner', () => this.cluster.seedOwner(databaseName, owner));

        await this.step('hostnames', () => this.hostnames.registerCanonical(workspaceId));

        this.logger.log(`Provisioned ${workspaceId}`);
    }

    /** Rebuilds the machines for another plan's topology; the database is untouched. */
    async convert(workspaceId: Workspace.Id, ownerId: User.Id, plan: Workspace.Plan): Promise<void> {
        const secrets = await this.secrets.get(workspaceId);

        if (!secrets)
            throw new ProvisioningError('secrets', 'no secrets for this workspace');

        const { baseEnvKeys, backendEnvKeys } = await this.getMachineEnvKeys(workspaceId, ownerId, secrets);
        // No health wait: the caller stops the hardware around a conversion and starts it after.
        await this.step('convert', () => this.hardware.convertTo(workspaceId, plan, baseEnvKeys, backendEnvKeys));
    }

    /** Rebuilds a workspace's machines from the current spec, keeping its data. */
    async rebuild(workspaceId: Workspace.Id, ownerId: User.Id, plan: Workspace.Plan): Promise<void> {
        const secrets = await this.secrets.get(workspaceId);

        if (!secrets)
            throw new ProvisioningError('secrets', 'no secrets for this workspace');

        const { baseEnvKeys, backendEnvKeys } = await this.getMachineEnvKeys(workspaceId, ownerId, secrets);
        // No health wait: the caller stops the hardware around a rebuild and starts it after.
        await this.step('rebuild', () => this.hardware.rebuild(workspaceId, plan, baseEnvKeys, backendEnvKeys));
    }

    /** The two env shapes a machine is built from; both need what only provisioning knows — owner, issuer, key material. */
    private async getMachineEnvKeys(
        workspaceId: Workspace.Id,
        ownerId:     User.Id,
        secrets:     Fleet.WorkspaceSecrets.MachineEnv,
    ): Promise<{ baseEnvKeys: Fleet.Machine.EnvKeys.Base; backendEnvKeys: Fleet.Machine.EnvKeys.Backend }> {
        return {
            baseEnvKeys: Fleet.Machine.EnvKeys.Base.parse(secrets),

            backendEnvKeys: Fleet.Machine.EnvKeys.Backend.parse({
                ...secrets,
                PRETZEL_CLOUD_TOKEN:        await this.secrets.getCloudToken(workspaceId) ?? '',
                AUTH_URL:                   requireEnv('WORKSPACE_AUTH_URL'),
                TOKEN_ISSUER:               this.workspaceTokenIssuer.issuer(),
                WORKSPACE_TOKEN_PUBLIC_KEY: JSON.stringify(await this.workspaceTokenIssuer.publicJwk()),
                WORKSPACE_OWNER_ID:         ownerId,
                CORS_ORIGIN:                Fleet.Hostname.Host.getOrigin(Workspace.Subdomain.canonical(workspaceId), 'app'),
                PRETZEL_CLOUD_URL:          requireEnv('PRETZEL_CLOUD_URL'),
                PUBLIC_AUTH_URL:            requireEnv('GOTRUE_EXTERNAL_URL'),
                PUBLIC_CLOUD_URL:           requireEnv('PORTAL_URL'),
                PUBLIC_SESSION_COOKIE_DOMAIN: Fleet.Hostname.Host.getCookieDomain(),
            }),
        };
    }

    /** Destroys what exists. Safe to call against a workspace that never got far. */
    async deprovision(workspaceId: Workspace.Id): Promise<void> {
        // Stopped before removed: a killed machine abandons its database connections instead of closing them.
        await this.hardware.stopAll(workspaceId);
        await this.hardware.destroy(workspaceId);
        await this.hostnames.delete(workspaceId);
        await this.secrets.delete(workspaceId);

        const databaseName = Provisioning.getDatabaseName(workspaceId)
        const dbRoleName = Provisioning.getRoleName(workspaceId)

        await this.cluster.dropDatabase(databaseName, dbRoleName);
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
