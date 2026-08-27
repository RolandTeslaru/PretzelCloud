import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { FleetDB } from '@/db/fleet';
import { SiloSecretsDatabase } from './silo-secrets.database';

/**
 * A workspace's key material. `get` returns the only shape it leaves in — the
 * machine env — never the row itself.
 */
@Injectable()
export class SiloSecretsService {

    constructor(private readonly siloSecretsDatabase: SiloSecretsDatabase) {}

    /** Idempotent: an existing row keeps its keys, so a re-run cannot strand ciphertext. */
    async ensure(workspaceId: Workspace.Id, databaseUrl: Fleet.Cluster.Database.ConnectionURL): Promise<void> {
        await FleetDB.asService('ensure workspace secrets', async (trx) => {
            if (await this.siloSecretsDatabase.exists(trx, workspaceId)) {
                await this.siloSecretsDatabase.setDatabaseUrl(trx, workspaceId, databaseUrl);
                return;
            }

            await this.siloSecretsDatabase.insert(trx, {
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
        });
    }

    async get(workspaceId: Workspace.Id): Promise<Fleet.SiloSecrets.MachineEnv | null> {
        return FleetDB.asService('read machine env', async (trx) => {
            const row = await this.siloSecretsDatabase.read(trx, workspaceId);

            return row ? FleetDB.SiloSecrets.toMachineEnv(FleetDB.SiloSecrets.Row.parse(row)) : null;
        });
    }

    /**
     * The backend's own credential for calling the control plane. Read
     * separately from the machine env because only one role may hold it — the
     * worker runs workflow code and must not be able to reach the fleet.
     */
    async getCloudToken(workspaceId: Workspace.Id): Promise<string | null> {
        return FleetDB.asService('read backend token', async (trx) => {
            const row = await this.siloSecretsDatabase.read(trx, workspaceId);

            return row ? FleetDB.SiloSecrets.Row.parse(row).cloud_token : null;
        });
    }

    async delete(workspaceId: Workspace.Id): Promise<void> {
        await FleetDB.asService('delete workspace secrets', (trx) => this.siloSecretsDatabase.deleteFor(trx, workspaceId));
    }
}
