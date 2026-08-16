import { Injectable, Logger } from '@nestjs/common';
import { Client } from 'pg';
import { randomBytes } from 'node:crypto';
import { Workspace } from '@pretzel-cloud/shared/domain';
import { requireEnv } from '@/db/table';

/**
 * The Postgres cluster workspace databases live in.
 *
 * Isolation is the connection string: each workspace gets its own database and
 * its own role, and CONNECT is taken back from PUBLIC so no other role in the
 * cluster can open a session against it.
 */
@Injectable()
export class ClusterService {

    private readonly logger = new Logger(ClusterService.name);

    /** Underscores, not hyphens: a uuid's dashes are not legal in an unquoted identifier. */
    private names(workspaceId: Workspace.Id) {
        const suffix = workspaceId.replace(/-/g, '');

        return { databaseName: `wspace_${suffix}`, roleName: `wspace_role_${suffix}` };
    }

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
     * Idempotent. A re-run against a half-provisioned workspace resets the
     * password and returns a usable connection string rather than failing.
     */
    async createDatabase(workspaceId: Workspace.Id): Promise<string> {
        const { databaseName, roleName } = this.names(workspaceId);
        const password = randomBytes(24).toString('base64url');

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

        const admin = new URL(requireEnv('CLUSTER_ADMIN_DATABASE_URL'));

        return `postgres://${roleName}:${password}@${admin.host}/${databaseName}`;
    }

    /** Idempotent. Open sessions are closed first — CONNECT is checked at connect time only. */
    async dropDatabase(workspaceId: Workspace.Id): Promise<void> {
        const { databaseName, roleName } = this.names(workspaceId);

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
}
