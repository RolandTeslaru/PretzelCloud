import { Injectable } from '@nestjs/common';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { FleetDB } from '@/db/fleet';
import { Repository, Transactional } from '@/db/repository';
import { Principal } from '@/auth/identity/principal';

/** Row operations on `silo_secrets`. No generation, no orchestration. */
@Injectable()
export class SiloSecretsRepository extends Repository(FleetDB) {

    @Transactional('service')
    public async read(principal: Principal.Service, workspaceId: Workspace.Id) {
        return this.trx
            .selectFrom('silo_secrets')
            .selectAll()
            .where('workspace_id', '=', workspaceId)
            .executeTakeFirst();
    }

    /** One statement: an existing row keeps its keys, only the database url follows. */
    @Transactional('service')
    public async upsert(principal: Principal.Service, values: {
        workspace_id: Workspace.Id;
        database_url: Fleet.Cluster.Database.ConnectionURL;
        encryption_key: string;
        execution_token_signing_key: string;
        router_secret: string;
        internal_token: string;
        redis_password: string;
        cloud_token: string;
    }): Promise<void> {
        await this.trx
            .insertInto('silo_secrets')
            .values(values)
            .onConflict((oc) => oc
                .column('workspace_id')
                .doUpdateSet({ database_url: (eb) => eb.ref('excluded.database_url') }))
            .execute();
    }

    @Transactional('service')
    public async deleteFor(principal: Principal.Service, workspaceId: Workspace.Id): Promise<void> {
        await this.trx
            .deleteFrom('silo_secrets')
            .where('workspace_id', '=', workspaceId)
            .execute();
    }
}
