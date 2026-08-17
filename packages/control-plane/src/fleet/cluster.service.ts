import { Injectable, Logger } from '@nestjs/common';
import { Client } from 'pg';
import { Fleet } from '@pretzel-cloud/shared/domain';
import { requireEnv } from '@/db/table';

const Cluster = Fleet.Cluster;

export type DatabaseSpec = {
    databaseName: Fleet.Cluster.Database.Name;
    roleName:     Fleet.Cluster.Role.Name;
};

/**
 * A Postgres cluster: creates a database with a single role that may reach it,
 * and drops them again.
 *
 * Deliberately ignorant of workspaces — it is handed names and does not ask
 * where they came from. What isolation *means* is here: CONNECT is taken back
 * from PUBLIC and granted to one role, so a leaked connection URL opens exactly
 * one database.
 */
@Injectable()
export class ClusterService {

    private readonly logger = new Logger(ClusterService.name);

    private async admin<T>(fn: (client: Client) => Promise<T>): Promise<T> {
        const client = new Client({
            connectionString: requireEnv('CLUSTER_ADMIN_DATABASE_URL'),
        });

        await client.connect();

        try {
            return await fn(client);
        }
        finally {
            await client.end();
        }
    }

    /**
     * Idempotent. A re-run against a half-created pair resets the password and
     * returns a usable connection URL rather than failing.
     */
    async createDatabase({ databaseName, roleName }: DatabaseSpec): Promise<Fleet.Cluster.Database.ConnectionURL> {
        const password = Cluster.Role.Password.create();

        await this.admin(async (client) => {
            const roleExists = await client.query('select 1 from pg_roles where rolname = $1', [roleName]);

            if (roleExists.rowCount)
                await client.query(`alter role "${roleName}" with login password '${password}'`);
            else
                await client.query(`create role "${roleName}" login password '${password}'`);

            const dbExists = await client.query('select 1 from pg_database where datname = $1', [databaseName]);

            // Cannot run inside a transaction block, which is why this whole
            // service uses a plain client.
            if (!dbExists.rowCount)
                await client.query(`create database "${databaseName}" owner "${roleName}"`);

            // pg_database is a shared catalog, so this reaches the new database
            // from here — no second connection needed.
            await client.query(`revoke connect on database "${databaseName}" from public`);
            await client.query(`grant connect on database "${databaseName}" to "${roleName}"`);
        });

        this.logger.log(`Provisioned database ${databaseName}`);

        return Cluster.Database.createConnectionURL({
            roleName,
            password,
            host: this.clientHost(),
            databaseName,
        });
    }

    /** Idempotent. Open sessions are closed first — CONNECT is checked at connect time only. */
    async dropDatabase({ databaseName, roleName }: DatabaseSpec): Promise<void> {
        await this.admin(async (client) => {
            await client.query(
                'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
                [databaseName],
            );

            await client.query(`drop database if exists "${databaseName}"`);
            await client.query(`drop role if exists "${roleName}"`);
        });

        this.logger.log(`Dropped database ${databaseName}`);
    }

    /**
     * Where clients reach the cluster, which is not where the control plane
     * reaches it: `localhost` from inside a container is the container.
     */
    private clientHost(): string {
        return process.env.CLUSTER_CLIENT_HOST ?? new URL(requireEnv('CLUSTER_ADMIN_DATABASE_URL')).host;
    }
}
