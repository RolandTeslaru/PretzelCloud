import { Injectable } from '@nestjs/common';
import { Fleet } from '@pretzel-cloud/shared/domain';
import { FleetDB } from '@/db/fleet';
import { Repository, Transactional } from '@/db/repository';
import { Principal } from '@/auth/identity/principal';

/** Row operations on `clusters`. */
@Injectable()
export class ClusterRepository extends Repository(FleetDB) {

    @Transactional('service')
    public async getById(principal: Principal.Service, clusterId: Fleet.Cluster.Id): Promise<Fleet.Cluster> {
        const row = await this.trx
            .selectFrom('clusters')
            .selectAll()
            .where('id', '=', clusterId)
            .executeTakeFirstOrThrow();

        return FleetDB.Cluster.toDomain(FleetDB.Cluster.Row.parse(row));
    }

    /** The clusters new workspaces may be placed on, oldest first. */
    @Transactional('service')
    public async getAccepting(principal: Principal.Service, region: Fleet.Region.Schema): Promise<Fleet.Cluster[]> {
        const rows = await this.trx
            .selectFrom('clusters')
            .selectAll()
            .where('accepting', '=', true)
            .where('region', '=', region)
            .orderBy('created_at', 'asc')
            .execute();

        return rows.map((row: unknown) => FleetDB.Cluster.toDomain(FleetDB.Cluster.Row.parse(row)));
    }
}
