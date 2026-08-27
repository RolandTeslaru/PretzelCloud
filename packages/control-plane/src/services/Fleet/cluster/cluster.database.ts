import { Injectable } from '@nestjs/common';
import { Fleet } from '@pretzel-cloud/shared/domain';
import { FleetDB } from '@/db/fleet';
import { AllowedDatabaseRoles, DatabaseClass } from '@/decorators/database';

type Trx = FleetDB.Transaction;

@Injectable()
@DatabaseClass
export class ClusterDatabase {

    @AllowedDatabaseRoles('service')
    public async getById(trx: Trx, clusterId: Fleet.Cluster.Id): Promise<Fleet.Cluster> {
        const row = await trx
            .selectFrom('clusters')
            .selectAll()
            .where('id', '=', clusterId)
            .executeTakeFirstOrThrow();

        return FleetDB.Cluster.toDomain(FleetDB.Cluster.Row.parse(row));
    }

    /** The clusters new workspaces may be placed on, oldest first. */
    @AllowedDatabaseRoles('service')
    public async getAccepting(trx: Trx): Promise<Fleet.Cluster[]> {
        const rows = await trx
            .selectFrom('clusters')
            .selectAll()
            .where('accepting', '=', true)
            .orderBy('created_at', 'asc')
            .execute();

        return rows.map((row: unknown) => FleetDB.Cluster.toDomain(FleetDB.Cluster.Row.parse(row)));
    }
}
