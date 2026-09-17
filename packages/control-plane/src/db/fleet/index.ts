import { z } from 'zod';
import { Kysely, PostgresDialect, Transaction as KyselyTransaction } from 'kysely';
import { Pool } from 'pg';
import { Fleet, Workspace as WorkspaceD } from '@pretzel-cloud/shared/domain';
import { Table, Stamps, requireEnv } from '../table';

// pg closes an idle connection after 10 s by default, and a router mostly idles between requests.
const IDLE_CONNECTION_MS = 10 * 60_000;

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
            hardware_id:  Fleet.Hardware.Id,
            driver:       Fleet.Driver.Kind,
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

        export const toDomain = (row: Row) => Fleet.Machine.Schema.parse({
            id:          row.id,
            workspaceId: row.workspace_id,
            hardwareId:  row.hardware_id,
            driver:      row.driver,
            resourceId:  row.external_id,
            role:        row.role,
            size:        row.size,
            state:       row.state,
            lastBootAt:  row.last_boot_at,
            lastSeenAt:  row.last_seen_at,
            createdAt:   row.created_at,
            updatedAt:   row.updated_at,
        });
    }

    export namespace SiloSecrets {
        export const Row = z.object({
            workspace_id:   WorkspaceD.Id,
            // text in the column; the brand is applied at the seam below.
            database_url:   z.string(),
            encryption_key: z.string(),
            router_secret:  z.string(),
            internal_token: z.string(),
            redis_password: z.string(),
            cloud_token:    z.string(),
            execution_token_signing_key: z.string(),
            created_at:     z.coerce.date(),
            updated_at:     z.coerce.date(),
        });
        export type Row = z.infer<typeof Row>;

        /** Everything this row is allowed to become. Nothing else may read it. */
        export const toMachineEnv = (row: Row) => Fleet.SiloSecrets.MachineEnv.parse({
            DATABASE_URL:           row.database_url,
            PRETZEL_ENCRYPTION_KEY: row.encryption_key,
            EXECUTION_TOKEN_SIGNING_KEY: row.execution_token_signing_key,
            WORKSPACE_ID:           row.workspace_id,
            TRUSTED_PROXY_TOKEN:    row.router_secret,
            WORKER_SERVICE_INTERNAL_TOKEN: row.internal_token,
            REDIS_PASSWORD: row.redis_password,
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

        // The seam: snake_case columns in, camelCase domain out.
        export const toDomain = (row: Row) => Fleet.Hostname.Schema.parse({
            host:        row.host,
            workspaceId: row.workspace_id,
            kind:        row.kind,
            createdAt:   row.created_at,
        });
    }

    export namespace Cluster {
        export const Row = z.object({
            id:         Fleet.Cluster.Id,
            name:       Fleet.Cluster.Name,
            host:       z.string(),
            port:       z.number().int(),
            ssl:        z.boolean(),
            region:     Fleet.Region.Schema,
            accepting:  z.boolean(),
            created_at: z.coerce.date(),
            updated_at: z.coerce.date(),
        });
        export type Row = z.infer<typeof Row>;

        export const toDomain = (row: Row) => Fleet.Cluster.Schema.parse({
            id:        row.id,
            name:      row.name,
            host:      row.host,
            port:      row.port,
            ssl:       row.ssl,
            region:    row.region,
            accepting: row.accepting,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        });
    }

    export namespace Release {
        export const Row = z.object({
            id:             Fleet.Release.Id,
            name:           Fleet.Release.Name,
            description:    z.string().nullable(),
            image_combined: z.string(),
            image_backend:  z.string(),
            image_worker:   z.string(),
            created_at:     z.coerce.date(),
        });
        export type Row = z.infer<typeof Row>;

        export const toDomain = (row: Row) => Fleet.Release.Schema.parse({
            id:            row.id,
            name:          row.name,
            description:   row.description,
            imageCombined: row.image_combined,
            imageBackend:  row.image_backend,
            imageWorker:   row.image_worker,
            createdAt:     row.created_at,
        });
    }

    export namespace Hardware {
        export const Row = z.object({
            id:           Fleet.Hardware.Id,
            workspace_id: WorkspaceD.Id,
            driver:       Fleet.Hardware.Driver,
            cluster_id:   Fleet.Cluster.Id,
            region:       Fleet.Region.Schema,
            release_id:   Fleet.Release.Id,
            last_boot_at: z.coerce.date().nullable(),
            last_seen_at: z.coerce.date().nullable(),
            created_at:   z.coerce.date(),
            updated_at:   z.coerce.date(),
        });
        export type Row = z.infer<typeof Row>;

        // Machines are the reverse foreign key — not a column, so the caller passes them.
        export const toDomain = (row: Row, machines: Fleet.Machine[]) => Fleet.Hardware.Schema.parse({
            id:          row.id,
            workspaceId: row.workspace_id,
            driver:      row.driver,
            clusterId:   row.cluster_id,
            region:      row.region,
            releaseId:   row.release_id,
            machines,
            lastBootAt:  row.last_boot_at,
            lastSeenAt:  row.last_seen_at,
            createdAt:   row.created_at,
            updatedAt:   row.updated_at,
        });
    }

    export namespace Usage {
        export const Row = z.object({
            id:           WorkspaceD.Usage.Id,
            workspace_id: WorkspaceD.Id,
            execution_id: z.uuid().nullable(),
            igniter:      z.string().nullable(),
            created_at:   z.coerce.date(),
        });
        export type Row = z.infer<typeof Row>;

        export const toDomain = (row: Row) => WorkspaceD.Usage.Schema.parse({
            id:          row.id,
            workspaceId: row.workspace_id,
            executionId: row.execution_id,
            igniter:     row.igniter,
            createdAt:   row.created_at,
        });
    }

    export interface Tables {
        clusters:          Table<typeof Cluster.Row, Stamps>;
        releases:          Table<typeof Release.Row, 'id' | 'created_at'>;
        hardware:          Table<typeof Hardware.Row, 'id' | Stamps>;
        machines:          Table<typeof Machine.Row, 'id' | Stamps>;
        silo_secrets:      Table<typeof SiloSecrets.Row, Stamps>;
        hostnames:         Table<typeof Hostname.Row, 'created_at'>;
        workspace_usage:   Table<typeof Usage.Row, 'id' | 'created_at'>;
    }

    let database: Kysely<Tables> | undefined;

    const db = () => (database ??= new Kysely<Tables>({
        dialect: new PostgresDialect({
            // Idle connections stay open: opening one to Neon costs more than most queries.
            pool: new Pool({ connectionString: requireEnv('FLEET_DATABASE_URL'), max: 10, idleTimeoutMillis: IDLE_CONNECTION_MS, keepAlive: true }),
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
