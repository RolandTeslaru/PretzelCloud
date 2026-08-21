import { Injectable } from '@nestjs/common';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { FleetDB } from '@/db/fleet';

type Trx = FleetDB.Transaction;

/** Row operations on `workspace_secrets`. No generation, no orchestration. */
@Injectable()
export class WorkspaceSecretsDatabase {

    read(trx: Trx, workspaceId: Workspace.Id) {
        return trx
            .selectFrom('workspace_secrets')
            .selectAll()
            .where('workspace_id', '=', workspaceId)
            .executeTakeFirst();
    }

    async exists(trx: Trx, workspaceId: Workspace.Id): Promise<boolean> {
        const row = await trx
            .selectFrom('workspace_secrets')
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
    }) {
        return trx.insertInto('workspace_secrets').values(values).execute();
    }

    setDatabaseUrl(trx: Trx, workspaceId: Workspace.Id, databaseUrl: Fleet.Cluster.Database.ConnectionURL) {
        return trx
            .updateTable('workspace_secrets')
            .set({ database_url: databaseUrl })
            .where('workspace_id', '=', workspaceId)
            .execute();
    }

    deleteFor(trx: Trx, workspaceId: Workspace.Id) {
        return trx.deleteFrom('workspace_secrets').where('workspace_id', '=', workspaceId).execute();
    }
}
