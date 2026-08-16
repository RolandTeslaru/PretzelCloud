import { z } from 'zod';
import { Kysely, PostgresDialect, Transaction as KyselyTransaction } from 'kysely';
import { Pool } from 'pg';
import { Fleet, Workspace as WorkspaceD } from '@pretzel-cloud/shared/domain';
import { Table, Stamps, requireEnv } from '../table';

/**
 * The fleet database: what has actually been materialized.
 *
 * One role and one entry point. There is no `asUser` here and there will not
 * be one — nothing that serves a browser holds this credential. `workspace_id`
 * is a plain uuid with no foreign key; the workspace it names lives in another
 * database and may not exist.
 */
export namespace FleetDB {

    export namespace Machine {
        export const Row = z.object({
            id:           Fleet.Machine.Id,
            workspace_id: WorkspaceD.Id,
            driver:       Fleet.Machine.Driver,
            external_id:  z.string(),
            role:         Fleet.Machine.Role,
            size:         z.string(),
            state:        Fleet.Machine.State,
            last_boot_at: z.coerce.date().nullable(),
            last_seen_at: z.coerce.date().nullable(),
            created_at:   z.coerce.date(),
            updated_at:   z.coerce.date(),
        });
        export type Row = z.infer<typeof Row>;

        export const toDomain = (row: Row) => Fleet.Machine.Schema.parse(row);
    }

    export namespace WorkspaceSecrets {
        export const Row = z.object({
            workspace_id:      WorkspaceD.Id,
            database_url:      z.string(),
            encryption_key_id: z.string(),
            encryption_key:    z.string(),
            created_at:        z.coerce.date(),
            updated_at:        z.coerce.date(),
        });
        export type Row = z.infer<typeof Row>;

        /** Everything this row is allowed to become. Nothing else may read it. */
        export const toMachineEnv = (row: Row) => Fleet.WorkspaceSecrets.MachineEnv.parse({
            DATABASE_URL:              row.database_url,
            PRETZEL_ENCRYPTION_KEY:    row.encryption_key,
            PRETZEL_ENCRYPTION_KEY_ID: row.encryption_key_id,
            WORKSPACE_ID:              row.workspace_id,
        });
    }

    export namespace Hostname {
        export const Row = z.object({
            host:         z.string(),
            workspace_id: WorkspaceD.Id,
            kind:         Fleet.Hostname.Kind,
            created_at:   z.coerce.date(),
        });
        export type Row = z.infer<typeof Row>;

        export const toDomain = (row: Row) => Fleet.Hostname.Schema.parse(row);
    }

    export namespace WorkspaceRuntime {
        export const Row = z.object({
            workspace_id:     WorkspaceD.Id,
            has_publications: z.boolean(),
            reported_at:      z.coerce.date().nullable(),
        });
        export type Row = z.infer<typeof Row>;

        export const toDomain = (row: Row) => Fleet.WorkspaceRuntime.Schema.parse(row);
    }

    export interface Tables {
        machines:          Table<typeof Machine.Row, 'id' | Stamps>;
        workspace_secrets: Table<typeof WorkspaceSecrets.Row, Stamps>;
        hostnames:         Table<typeof Hostname.Row, 'created_at'>;
        workspace_runtime: Table<typeof WorkspaceRuntime.Row, never>;
    }

    let database: Kysely<Tables> | undefined;

    const db = () => (database ??= new Kysely<Tables>({
        dialect: new PostgresDialect({
            pool: new Pool({ connectionString: requireEnv('FLEET_DATABASE_URL'), max: 10 }),
        }),
    }));

    export const Role = { Service: 'service' } as const;
    export type  Role = typeof Role[keyof typeof Role];

    export type Transaction = KyselyTransaction<Tables> & { readonly __as: typeof Role.Service };

    const ROLE = Symbol.for('pretzel.cloud.fleet.role');

    export const roleOf = (handle: unknown): Role | undefined =>
        (handle as Record<symbol, Role> | null | undefined)?.[ROLE];

    /** `reason` is mandatory so every use is greppable. */
    export async function asService<T>(
        reason: string,
        fn: (trx: Transaction) => Promise<T>,
    ): Promise<T> {
        void reason;

        return db().transaction().execute((trx) => {
            Object.defineProperty(trx, ROLE, { value: Role.Service, enumerable: false, configurable: true });

            return fn(trx as Transaction);
        });
    }

    export function forMigrations(): Kysely<Tables> {
        return db();
    }

    export async function destroyPools(): Promise<void> {
        await database?.destroy();
        database = undefined;
    }
}
