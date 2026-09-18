import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { Fleet } from '@pretzel-cloud/shared/domain';
import { requireEnv } from '@/db/table';
import { Principal } from '@/auth/identity/principal';
import { ClusterRepository } from './cluster.repository';

const Cluster = Fleet.Cluster;

/**
 * Creates a Postgres database with a single role that may reach it, and drops them again.
 * CONNECT is revoked from PUBLIC and granted to that role, so a leaked connection URL
 * opens exactly one database.
 */
@Injectable()
export class ClusterService implements OnModuleDestroy {

    private readonly logger = new Logger(ClusterService.name);

    /** One small pool per cluster, so repeated admin work reuses a connection instead of dialing. */
    private readonly poolByClusterId = new Map<Fleet.Cluster.Id, Pool>();

    constructor(private readonly clusterRepository: ClusterRepository) {}




    public async onModuleDestroy(): Promise<void> {
        await Promise.all([...this.poolByClusterId.values()].map((pool) => pool.end()));
    }




    /** Where a new workspace's database goes: the oldest accepting cluster in its region, so one fills before the next opens. */
    public async getClusterForNewWorkspace(region: Fleet.Region.Schema): Promise<Fleet.Cluster> {
        const accepting = await this.clusterRepository.getAccepting(Principal.SELF, region);

        const cluster = accepting[0];

        if (!cluster)
            throw new Error(`No cluster in ${region} is accepting new workspaces`);

        return cluster;
    }




    public getClusterById(clusterId: Fleet.Cluster.Id): Promise<Fleet.Cluster> {
        return this.clusterRepository.getById(Principal.SELF, clusterId);
    }




    /**
     * The credential that administers a cluster, named after it. Held in the
     * environment rather than beside the row: it reaches every database on that
     * cluster, and the fleet database holds one workspace's worth of access.
     */
    public getAdminUrlForCluster(cluster: Fleet.Cluster): string {
        return requireEnv(`CLUSTER_ADMIN_URL_${cluster.name.toUpperCase()}`);
    }

    private async admin<T>(cluster: Fleet.Cluster, fn: (client: PoolClient) => Promise<T>): Promise<T> {
        let pool = this.poolByClusterId.get(cluster.id);

        if (!pool) {
            pool = new Pool({
                connectionString: this.getAdminUrlForCluster(cluster),
                max: 2,
                idleTimeoutMillis: 30_000,
            });

            this.poolByClusterId.set(cluster.id, pool);
        }

        const client = await pool.connect();

        try {
            return await fn(client);
        }
        finally {
            client.release();
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

            // Creating a database owned by a role requires membership in it,
            // which an admin that is not superuser does not hold implicitly.
            await client.query(`grant "${roleName}" to current_user`);

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
            // A development fleet on another substrate reaches the local cluster at another address.
            host: process.env.CLUSTER_CLIENT_HOST ?? Cluster.getAddress(cluster),
            databaseName,
            ssl:  cluster.ssl,
        });
    }

    /** The database's size on disk, or null when it does not exist there. */
    async getDatabaseSizeBytes(cluster: Fleet.Cluster, databaseName: Fleet.Cluster.Database.Name): Promise<number | null> {
        return this.admin(cluster, async (client) => {
            const result = await client.query<{ size: string }>(
                'select pg_database_size(datname) as size from pg_database where datname = $1',
                [databaseName],
            );

            const size = result.rows[0]?.size;

            return size === undefined ? null : Number(size);
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
