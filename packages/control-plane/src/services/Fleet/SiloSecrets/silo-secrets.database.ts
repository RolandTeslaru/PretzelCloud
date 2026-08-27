import { Injectable } from '@nestjs/common';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { FleetDB } from '@/db/fleet';

type Trx = FleetDB.Transaction;

/** Row operations on `silo_secrets`. No generation, no orchestration. */
@Injectable()
export class SiloSecretsDatabase {

    read(trx: Trx, workspaceId: Workspace.Id) {
        return trx
            .selectFrom('silo_secrets')
            .selectAll()
            .where('workspace_id', '=', workspaceId)
            .executeTakeFirst();
    }

    async exists(trx: Trx, workspaceId: Workspace.Id): Promise<boolean> {
        const row = await trx
            .selectFrom('silo_secrets')
            .select('workspace_id')
            .where('workspace_id', '=', workspaceId)
            .executeTakeFirst();

        return Boolean(row);
    }

    insert(trx: Trx, values: {
        workspace_id: Workspace.Id;
        database_url: Fleet.Cluster.Database.ConnectionURL;
        encryption_key: string;
        execution_token_signing_key: string;
        router_secret: string;
        internal_token: string;
        redis_password: string;
        cloud_token: string;
    }) {
        return trx.insertInto('silo_secrets').values(values).execute();
    }

    setDatabaseUrl(trx: Trx, workspaceId: Workspace.Id, databaseUrl: Fleet.Cluster.Database.ConnectionURL) {
        return trx
            .updateTable('silo_secrets')
            .set({ database_url: databaseUrl })
            .where('workspace_id', '=', workspaceId)
            .execute();
    }

    deleteFor(trx: Trx, workspaceId: Workspace.Id) {
        return trx.deleteFrom('silo_secrets').where('workspace_id', '=', workspaceId).execute();
    }
}
