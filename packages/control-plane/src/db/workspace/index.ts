import { z } from 'zod';
import { Kysely, PostgresDialect, Transaction as KyselyTransaction } from 'kysely';
import { Pool } from 'pg';
import { Fleet, User as UserD } from '@pretzel-cloud/shared/domain';
import { Table, Stamps, requireEnv } from '../table';

/**
 * A workspace's own database. One of many, reached briefly and let go — so
 * unlike the portal and fleet handles there is no pool to keep.
 *
 * Only the tables the control plane writes are described here; a workspace owns
 * the rest and this never reads them.
 */
export namespace WorkspaceDB {

    export namespace User {
        export const Row = z.object({
            id:           UserD.Id,
            email:        z.string(),
            username:     z.string(),
            display_name: z.string(),
            avatar_url:   z.string().nullable(),
            created_at:   z.coerce.date(),
            updated_at:   z.coerce.date(),
        });
        export type Row = z.infer<typeof Row>;
    }

    export namespace Member {
        export const Role = z.enum(['owner', 'admin', 'member']);
        export type  Role = z.infer<typeof Role>;

        export const Row = z.object({
            user_id:    UserD.Id,
            role:       Role,
            created_at: z.coerce.date(),
            updated_at: z.coerce.date(),
        });
        export type Row = z.infer<typeof Row>;
    }

    /** One row, holding whether this deployment already has an owner. */
    export namespace Deployment {
        export const Row = z.object({
            id:         z.boolean(),
            claimed_by: UserD.Id.nullable(),
            claimed_at: z.coerce.date().nullable(),
        });
        export type Row = z.infer<typeof Row>;
    }

    export interface Tables {
        users:      Table<typeof User.Row, Stamps>;
        members:    Table<typeof Member.Row, Stamps>;
        deployment: Table<typeof Deployment.Row, 'id'>;
    }

    export type Transaction = KyselyTransaction<Tables>;

    /**
     * One workspace database, on the admin credential. The URL handed to a
     * workspace names the cluster as a container reaches it, which is not how
     * this process reaches it — so the address comes from the cluster's admin
     * connection and only the database name is taken from the caller.
     *
     * `reason` is mandatory so every use is greppable.
     */
    export async function withWorkspaceDatabase<T>(
        reason: string,
        adminUrl: string,
        databaseName: Fleet.Cluster.Database.Name,
        fn: (trx: Transaction) => Promise<T>,
    ): Promise<T> {
        void reason;

        const url = new URL(adminUrl);

        url.pathname = `/${databaseName}`;

        const db = new Kysely<Tables>({
            dialect: new PostgresDialect({
                pool: new Pool({ connectionString: url.toString(), max: 1 }),
            }),
        });

        try {
            return await db.transaction().execute(fn);
        }
        finally {
            await db.destroy();
        }
    }
}
