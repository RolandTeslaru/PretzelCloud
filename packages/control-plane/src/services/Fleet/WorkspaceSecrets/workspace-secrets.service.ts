import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { FleetDB } from '@/db/fleet';
import { WorkspaceSecretsDatabase } from './workspace-secrets.database';

/**
 * A workspace's key material. `get` returns the only shape it leaves in — the
 * machine env — never the row itself.
 */
@Injectable()
export class WorkspaceSecretsService {

    constructor(private readonly db: WorkspaceSecretsDatabase) {}

    /** Idempotent: an existing row keeps its keys, so a re-run cannot strand ciphertext. */
    async ensure(workspaceId: Workspace.Id, databaseUrl: Fleet.Cluster.Database.ConnectionURL): Promise<void> {
        await FleetDB.asService('ensure workspace secrets', async (trx) => {
            if (await this.db.exists(trx, workspaceId)) {
                await this.db.setDatabaseUrl(trx, workspaceId, databaseUrl);
                return;
            }

            await this.db.insert(trx, {
                workspace_id:                workspaceId,
                database_url:                databaseUrl,
                // 32 bytes as hex, the shape PRETZEL_ENCRYPTION_KEY requires.
                encryption_key:              randomBytes(32).toString('hex'),
                execution_token_signing_key: randomBytes(32).toString('hex'),
                router_secret:               randomBytes(32).toString('hex'),
            });
        });
    }

    async get(workspaceId: Workspace.Id): Promise<Fleet.WorkspaceSecrets.MachineEnv | null> {
        return FleetDB.asService('read machine env', async (trx) => {
            const row = await this.db.read(trx, workspaceId);

            return row ? FleetDB.WorkspaceSecrets.toMachineEnv(FleetDB.WorkspaceSecrets.Row.parse(row)) : null;
        });
    }

    async delete(workspaceId: Workspace.Id): Promise<void> {
        await FleetDB.asService('delete workspace secrets', (trx) => this.db.deleteFor(trx, workspaceId));
    }
}
