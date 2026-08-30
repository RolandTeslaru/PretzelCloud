import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { FleetDB } from '@/db/fleet';
import { Principal } from '@/auth/identity/principal';
import { SiloSecretsRepository } from './silo-secrets.repository';

/**
 * A workspace's key material. `get` returns the only shape it leaves in — the
 * machine env — never the row itself.
 */
@Injectable()
export class SiloSecretsService {

    constructor(private readonly siloSecretsRepository: SiloSecretsRepository) {}

    /** Idempotent: an existing row keeps its keys, so a re-run cannot strand ciphertext. */
    public async ensure(workspaceId: Workspace.Id, databaseUrl: Fleet.Cluster.Database.ConnectionURL): Promise<void> {
        await this.siloSecretsRepository.upsert(Principal.SELF, {
            workspace_id:                workspaceId,
            database_url:                databaseUrl,
            // 32 bytes as hex, the shape PRETZEL_ENCRYPTION_KEY requires.
            encryption_key:              randomBytes(32).toString('hex'),
            execution_token_signing_key: randomBytes(32).toString('hex'),
            router_secret:               randomBytes(32).toString('hex'),
            internal_token:              randomBytes(32).toString('hex'),
            redis_password:              randomBytes(32).toString('hex'),
            cloud_token:                 randomBytes(32).toString('hex'),
        });
    }

    public async get(workspaceId: Workspace.Id): Promise<Fleet.SiloSecrets.MachineEnv | null> {
        const row = await this.siloSecretsRepository.read(Principal.SELF, workspaceId);

        return row ? FleetDB.SiloSecrets.toMachineEnv(FleetDB.SiloSecrets.Row.parse(row)) : null;
    }

    /**
     * The backend's own credential for calling the control plane. Read
     * separately from the machine env because only one role may hold it — the
     * worker runs workflow code and must not be able to reach the fleet.
     */
    public async getCloudToken(workspaceId: Workspace.Id): Promise<string | null> {
        const row = await this.siloSecretsRepository.read(Principal.SELF, workspaceId);

        return row ? FleetDB.SiloSecrets.Row.parse(row).cloud_token : null;
    }

    public async delete(workspaceId: Workspace.Id): Promise<void> {
        await this.siloSecretsRepository.deleteFor(Principal.SELF, workspaceId);
    }
}
