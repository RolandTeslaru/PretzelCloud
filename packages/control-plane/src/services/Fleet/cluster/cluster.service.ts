import { Injectable, Logger } from '@nestjs/common';
import { Client } from 'pg';
import { Fleet } from '@pretzel-cloud/shared/domain';
import { requireEnv } from '@/db/table';
import { FleetDB } from '@/db/fleet';
import { ClusterDatabase } from './cluster.database';

const Cluster = Fleet.Cluster;

/**
 * Creates a Postgres database with a single role that may reach it, and drops them again.
 * CONNECT is revoked from PUBLIC and granted to that role, so a leaked connection URL
 * opens exactly one database.
 */
@Injectable()
export class ClusterService {

    private readonly logger = new Logger(ClusterService.name);

    constructor(private readonly clusterDatabase: ClusterDatabase) {}




    /** Where a new workspace's database goes. Oldest accepting cluster, so one fills before the next opens. */
    public async getClusterForNewWorkspace(): Promise<Fleet.Cluster> {
        const accepting = await FleetDB.asService('read accepting clusters', (trx) =>
            this.clusterDatabase.getAccepting(trx));

        const cluster = accepting[0];

        if (!cluster)
            throw new Error('No cluster is accepting new workspaces');

        return cluster;
    }




    public getClusterById(clusterId: Fleet.Cluster.Id): Promise<Fleet.Cluster> {
        return FleetDB.asService('read cluster', (trx) => this.clusterDatabase.getById(trx, clusterId));
    }




    /**
     * The credential that administers a cluster, named after it. Held in the
     * environment rather than beside the row: it reaches every database on that
     * cluster, and the fleet database holds one workspace's worth of access.
     */
    public getAdminUrlForCluster(cluster: Fleet.Cluster): string {
        return requireEnv(`CLUSTER_ADMIN_URL_${cluster.name.toUpperCase()}`);
    }

    private async admin<T>(cluster: Fleet.Cluster, fn: (client: Client) => Promise<T>): Promise<T> {
        const client = new Client({
            connectionString: this.getAdminUrlForCluster(cluster),
        });

        await client.connect();

        try {
            return await fn(client);
        }
        finally {
            await client.end();
        }
    }


    /** Idempotent. A re-run against a half-created pair resets the password rather than failing. */
    async createDatabase(
        cluster:      Fleet.Cluster,
        databaseName: Fleet.Cluster.Database.Name,
        roleName:     Fleet.Cluster.Role.Name,
    ): Promise<Fleet.Cluster.Database.ConnectionURL> {
        const password = Cluster.Role.Password.create();

        await this.admin(cluster, async (client) => {
            const roleExists = await client.query('select 1 from pg_roles where rolname = $1', [roleName]);

            if (roleExists.rowCount)
                await client.query(`alter role "${roleName}" with login password '${password}'`);
            else
                await client.query(`create role "${roleName}" login password '${password}'`);

            const dbExists = await client.query('select 1 from pg_database where datname = $1', [databaseName]);

            // Cannot run inside a transaction block, which is why this service uses a plain client.
            if (!dbExists.rowCount)
                await client.query(`create database "${databaseName}" owner "${roleName}"`);

            // pg_database is a shared catalog, so this reaches the new database from here.
            await client.query(`revoke connect on database "${databaseName}" from public`);
            await client.query(`grant connect on database "${databaseName}" to "${roleName}"`);
        });

        this.logger.log(`Provisioned database ${databaseName}`);

        return Cluster.Database.createConnectionURL({
            roleName,
            password,
            host: Cluster.getAddress(cluster),
            databaseName,
        });
    }

    /** Idempotent. Open sessions are closed first — CONNECT is checked at connect time only. */
    async dropDatabase(
        cluster:      Fleet.Cluster,
        databaseName: Fleet.Cluster.Database.Name,
        roleName:     Fleet.Cluster.Role.Name,
    ): Promise<void> {
        await this.admin(cluster, async (client) => {
            await client.query(
                'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
                [databaseName],
            );

            await client.query(`drop database if exists "${databaseName}"`);
            await client.query(`drop role if exists "${roleName}"`);
        });

        this.logger.log(`Dropped database ${databaseName}`);
    }

}
