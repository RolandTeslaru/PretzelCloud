import { Injectable, Logger } from '@nestjs/common';
import { Fleet, Plan, User, Workspace } from '@pretzel-cloud/shared/domain';
import { SiloSecretsService } from '../SiloSecrets/silo-secrets.service';
import { HardwareService } from '../Hardware/hardware.service';
import { SiloDatabase } from '../Silo/silo.database';
import { SiloDatabaseService } from '../Silo/silo-database.service';
import { HostnameService } from '../Hostname/hostname.service';
import { requireEnv } from '@/db/table';
import { SiloTokenIssuer } from '@/services/SiloSession/token-issuer.service';
import { PlanRegistry } from '@/services/Plan/plan.registry';

export class ProvisioningError extends Error {
    constructor(readonly step: string, cause: unknown) {
        // Kept, not just described: the caller decides what to do from the kind
        // of failure this was, and a message cannot say.
        super(`Provisioning failed at ${step}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    }
}

/** Materializes an already-written workspace; every step re-runs under the same id and nothing unwinds on failure. */
@Injectable()
export class ProvisioningService {

    private readonly logger = new Logger(ProvisioningService.name);

    constructor(
        private readonly siloSecretsService:  SiloSecretsService,
        private readonly hardwareService: HardwareService,
        private readonly hostnameService: HostnameService,
        private readonly siloTokenIssuer: SiloTokenIssuer,
        private readonly planRegistry: PlanRegistry,
        private readonly siloDatabaseService: SiloDatabaseService,
        private readonly siloDatabase: SiloDatabase,
    ) {}


    async provision(workspaceId: Workspace.Id, owner: User, planId: Plan.Id): Promise<void> {
        const databaseUrl = await this.step('hardware', () => this.hardwareService.provision(workspaceId));

        await this.step('secrets', () => this.siloSecretsService.ensure(workspaceId, databaseUrl));

        const secrets = await this.step('secrets', () => this.siloSecretsService.get(workspaceId));

        if (!secrets)
            throw new ProvisioningError('secrets', 'no secrets after writing them');

        const { baseEnvKeys, backendEnvKeys } = await this.assembleMachineEnvKeys(workspaceId, owner.id, secrets);

        const plan = this.planRegistry.get(planId);

        await this.step('machines', () => this.hardwareService.assemble(workspaceId, plan, baseEnvKeys, backendEnvKeys));

        // Before hostnames: a machine that never serves should not be published.
        await this.step('health', () => this.hardwareService.awaitHealthy(workspaceId));

        // After health, which is what says the workspace has run its migrations.
        await this.step('owner', () => 
            this.siloDatabaseService.transact('seed workspace owner', workspaceId, (trx) => 
                this.siloDatabase.seedOwner(trx, owner)
            )
        );

        await this.step('hostnames', () => this.hostnameService.registerCanonical(workspaceId));

        this.logger.log(`Provisioned ${workspaceId}`);
    }

    /** Rebuilds the machines for another plan's topology; the database is untouched. */
    async convert(workspaceId: Workspace.Id, ownerId: User.Id, planId: Plan.Id): Promise<void> {
        const secrets = await this.siloSecretsService.get(workspaceId);

        if (!secrets)
            throw new ProvisioningError('secrets', 'no secrets for this workspace');

        const { baseEnvKeys, backendEnvKeys } = await this.assembleMachineEnvKeys(workspaceId, ownerId, secrets);

        const plan = this.planRegistry.get(planId);

        // No health wait: the caller stops the hardware around a conversion and starts it after.
        await this.step('convert', () => this.hardwareService.convertTo(workspaceId, plan, baseEnvKeys, backendEnvKeys));
    }

    /** Rebuilds a workspace's machines from the current spec, keeping its data. */
    async rebuild(workspaceId: Workspace.Id, ownerId: User.Id, planId: Plan.Id): Promise<void> {
        const secrets = await this.siloSecretsService.get(workspaceId);

        if (!secrets)
            throw new ProvisioningError('secrets', 'no secrets for this workspace');

        const { baseEnvKeys, backendEnvKeys } = await this.assembleMachineEnvKeys(workspaceId, ownerId, secrets);

        const plan = this.planRegistry.get(planId);

        // No health wait: the caller stops the hardware around a rebuild and starts it after.
        await this.step('rebuild', () => this.hardwareService.rebuild(workspaceId, plan, baseEnvKeys, backendEnvKeys));
    }

    /** The two env shapes a machine is built from; both need what only provisioning knows — owner, issuer, key material. */
    private async assembleMachineEnvKeys(
        workspaceId: Workspace.Id,
        ownerId:     User.Id,
        secrets:     Fleet.SiloSecrets.MachineEnv,
    ): Promise<{ baseEnvKeys: Fleet.Machine.EnvKeys.Base; backendEnvKeys: Fleet.Machine.EnvKeys.Backend }> {
        // Every machine the fleet runs, whatever a self-hoster does with theirs.
        const hardening = { BLOCK_OUTBOUND_SMTP: '1', REFUSE_PRIVATE_NETWORK: '1' };

        return {
            baseEnvKeys: Fleet.Machine.EnvKeys.Base.parse({ ...secrets, ...hardening }),

            backendEnvKeys: Fleet.Machine.EnvKeys.Backend.parse({
                ...secrets,
                ...hardening,
                PRETZEL_CLOUD_TOKEN:        await this.siloSecretsService.getCloudToken(workspaceId) ?? '',
                AUTH_URL:                   requireEnv('WORKSPACE_AUTH_URL'),
                TOKEN_ISSUER:               this.siloTokenIssuer.issuer(),
                WORKSPACE_TOKEN_PUBLIC_KEY: JSON.stringify(await this.siloTokenIssuer.publicJwk()),
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
        await this.hardwareService.stopAll(workspaceId);
        await this.hardwareService.destroy(workspaceId);
        await this.hostnameService.delete(workspaceId);
        await this.siloSecretsService.delete(workspaceId);
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
