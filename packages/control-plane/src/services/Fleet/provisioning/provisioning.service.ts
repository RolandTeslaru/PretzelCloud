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
import { RealtimeService } from '@/services/Realtime/realtime.service';

export class ProvisioningError extends Error {
    constructor(readonly step: Workspace.Provisioning.Step, cause: unknown) {
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
        private readonly siloSecrets:         SiloSecretsService,
        private readonly hardware:            HardwareService,
        private readonly hostname:            HostnameService,
        private readonly siloTokenIssuer:     SiloTokenIssuer,
        private readonly planRegistry:        PlanRegistry,
        private readonly siloDatabaseService: SiloDatabaseService,
        private readonly siloDatabase:        SiloDatabase,
        private readonly realtime:            RealtimeService,
    ) {}


    async provision(workspaceId: Workspace.Id, owner: User, planId: Plan.Id, region: Fleet.Region.Schema): Promise<void> {
        const databaseUrl = await this.step(workspaceId, 'hardware', () => 
            this.hardware.provision(workspaceId, region)
        );

        await this.step(workspaceId, 'secrets', () =>     
            this.siloSecrets.ensure(workspaceId, databaseUrl)
        );

        const secrets = await this.step(workspaceId, 'secrets', () => 
            this.siloSecrets.get(workspaceId)
        );

        if (!secrets)
            throw new ProvisioningError('secrets', 'no secrets after writing them');

        const plan = this.planRegistry.get(planId);

        const { baseEnvKeys, backendEnvKeys } = await this.assembleMachineEnvKeys(workspaceId, owner.id, plan, secrets);

        // Serving on return, so a machine that never answers is never published below.
        await this.step(workspaceId, 'machines', () => 
            this.hardware.assemble(workspaceId, plan, baseEnvKeys, backendEnvKeys)
        );

        // After the machines serve, which is what says the workspace has run its migrations.
        await this.step(workspaceId, 'owner', () => 
            this.siloDatabaseService.transact('seed workspace owner', workspaceId, (trx) => 
                this.siloDatabase.seedOwner(trx, owner)
            )
        );

        await this.step(workspaceId, 'hostnames', () => this.hostname.registerCanonical(workspaceId));

        this.logger.log(`Provisioned ${workspaceId}`);
    }

    /** Rebuilds the machines for another plan's topology; the database is untouched. */
    async convert(workspaceId: Workspace.Id, ownerId: User.Id, planId: Plan.Id): Promise<void> {
        const secrets = await this.siloSecrets.get(workspaceId);

        if (!secrets)
            throw new ProvisioningError('secrets', 'no secrets for this workspace');

        const plan = this.planRegistry.get(planId);

        const { baseEnvKeys, backendEnvKeys } = await this.assembleMachineEnvKeys(workspaceId, ownerId, plan, secrets);

        // No health wait: the caller stops the hardware around a conversion and starts it after.
        await this.step(workspaceId, 'convert', () => 
            this.hardware.convertTo(workspaceId, plan, baseEnvKeys, backendEnvKeys)
        );
    }

    /** Rebuilds a workspace's machines from the current spec, keeping its data. */
    async rebuild(workspaceId: Workspace.Id, ownerId: User.Id, planId: Plan.Id): Promise<void> {
        const secrets = await this.siloSecrets.get(workspaceId);

        if (!secrets)
            throw new ProvisioningError('secrets', 'no secrets for this workspace');

        const plan = this.planRegistry.get(planId);

        const { baseEnvKeys, backendEnvKeys } = await this.assembleMachineEnvKeys(workspaceId, ownerId, plan, secrets);

        // No health wait: the caller stops the hardware around a rebuild and starts it after.
        await this.step(workspaceId, 'rebuild', () => this.hardware.rebuild(workspaceId, plan, baseEnvKeys, backendEnvKeys));
    }

    /** The two env shapes a machine is built from; both need what only provisioning knows — owner, issuer, key material. */
    private async assembleMachineEnvKeys(
        workspaceId: Workspace.Id,
        ownerId:     User.Id,
        plan:        Plan,
        secrets:     Fleet.SiloSecrets.MachineEnv,
    ): Promise<{ baseEnvKeys: Fleet.Machine.EnvKeys.Base; backendEnvKeys: Fleet.Machine.EnvKeys.Backend }> {
        // Every machine the fleet runs, whatever a self-hoster does with theirs.
        const hardening = { BLOCK_OUTBOUND_SMTP: '1', REFUSE_PRIVATE_NETWORK: '1' };

        // What the plan row bounds, delivered as the machine's own configuration.
        const limits = { EXECUTION_CONCURRENCY: String(plan.executionConcurrencyLimit) };

        return {
            baseEnvKeys: Fleet.Machine.EnvKeys.Base.parse({ ...secrets, ...hardening, ...limits }),

            backendEnvKeys: Fleet.Machine.EnvKeys.Backend.parse({
                ...secrets,
                ...hardening,
                ...limits,
                PRETZEL_CLOUD_TOKEN:        await this.siloSecrets.getCloudToken(workspaceId) ?? '',
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
        try {
            await this.hardware.lifecycle.stopAll(workspaceId);
        }
        catch (error) {
            this.logger.warn(`Could not stop the machines of ${workspaceId}; destroying anyway: ${error instanceof Error ? error.message : error}`);
        }

        // Machines gone from under the records must not keep the workspace alive.
        try {
            await this.hardware.destroy(workspaceId);
        }
        catch (error) {
            this.logger.warn(`Could not destroy the hardware of ${workspaceId}; continuing: ${error instanceof Error ? error.message : error}`);
        }

        await this.hostname.delete(workspaceId);
        await this.siloSecrets.delete(workspaceId);
    }

    private emit(workspaceId: Workspace.Id, step: Workspace.Provisioning.Step, failed?: boolean): void {
        const channel = Workspace.Event.getChannel(workspaceId);

        const type = failed ? 'provisioning:step:failed' : 'provisioning:step'

        const event = Workspace.Event.create(type, { step });

        this.realtime.publish(channel, { ...event, channel, workspaceId });
    }

    private async step<T>(
        workspaceId: Workspace.Id,
        name:        Workspace.Provisioning.Step,
        fn:          () => Promise<T>,
    ): Promise<T> {
        try {
            this.emit(workspaceId, name);
            return await fn();
        }
        catch (cause) {
            this.emit(workspaceId, name, true);
            throw new ProvisioningError(name, cause);
            this
        }
    }
}
