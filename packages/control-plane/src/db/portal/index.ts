import { z } from 'zod';
import { Kysely, PostgresDialect, sql, Transaction as KyselyTransaction } from 'kysely';
import { Pool } from 'pg';
import {
    Fleet,
    User      as UserD,
    Workspace as WorkspaceD,
} from '@pretzel-cloud/shared/domain';
import { Table, Stamps, requireEnv } from '../table';

/**
 * The portal database: desired state, and who may reach it.
 *
 * Two pools over two roles. `portal_app` owns nothing and every statement it
 * makes passes an RLS policy; `portal_service` owns the tables and is not
 * subject to them. The type below carries no fleet tables, so reaching across
 * from a user-facing path is a compile error before it is a permission denial.
 */
export namespace PortalDB {

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

        export const toDomain = (row: Row) => UserD.Schema.parse({
            id:          row.id,
            email:       row.email,
            username:    row.username,
            displayName: row.display_name,
            avatarUrl:   row.avatar_url,
            createdAt:   row.created_at,
            updatedAt:   row.updated_at,
        });
    }

    export namespace Workspace {
        export const Row = z.object({
            id:           WorkspaceD.Id,
            subdomain:    z.string().nullable(),
            display_name: z.string(),
            status:       WorkspaceD.Status,
            plan:         WorkspaceD.Plan,
            owner_id:     UserD.Id,
            created_at:   z.coerce.date(),
            updated_at:   z.coerce.date(),
        });
        export type Row = z.infer<typeof Row>;

        export const toDomain = (row: Row) => WorkspaceD.Schema.parse({
            id:          row.id,
            subdomain:   row.subdomain,
            displayName: row.display_name,
            status:      row.status,
            plan:        row.plan,
            ownerId:     row.owner_id,
            appUrl:      Fleet.Hostname.Host.getOrigin(WorkspaceD.Subdomain.canonical(row.id), 'app'),
            createdAt:   row.created_at,
            updatedAt:   row.updated_at,
        });
    }

    // The access index. No role, and no toDomain — there is no domain entity
    // here, only a fact about who may enter.
    export namespace Member {
        export const Row = z.object({
            workspace_id: WorkspaceD.Id,
            user_id:      UserD.Id,
            created_at:   z.coerce.date(),
        });
        export type Row = z.infer<typeof Row>;
    }

    export interface Tables {
        users:             Table<typeof User.Row, Stamps>;
        workspaces:        Table<typeof Workspace.Row, Stamps>;
        workspace_members: Table<typeof Member.Row, 'created_at'>;
    }

    function connect(urlEnvVar: string): Kysely<Tables> {
        return new Kysely<Tables>({
            dialect: new PostgresDialect({
                pool: new Pool({ connectionString: requireEnv(urlEnvVar), max: 10 }),
            }),
        });
    }

    // Lazy so importing this module cannot crash a process that has not been
    // configured for it, and so env is read after it has been loaded.
    let appDb: Kysely<Tables> | undefined;
    let serviceDb: Kysely<Tables> | undefined;

    const app     = () => (appDb     ??= connect('PORTAL_DATABASE_URL_APP'));
    const service = () => (serviceDb ??= connect('PORTAL_DATABASE_URL_SERVICE'));

    export const Role = { User: 'user', Service: 'service' } as const;
    export type  Role = typeof Role[keyof typeof Role];

    /**
     * A transaction, branded with the identity it runs as. No default on `R` —
     * a signature must state which roles it accepts, so the permissive form
     * costs more to write than the safe one.
     */
    export type Transaction<R extends Role> = KyselyTransaction<Tables> & { readonly __as: R };

    export type UserTransaction    = Transaction<typeof Role.User>;
    export type ServiceTransaction = Transaction<typeof Role.Service>;

    const ROLE = Symbol.for('pretzel.cloud.portal.role');

    const tag = <R extends Role>(trx: KyselyTransaction<Tables>, role: R): Transaction<R> => {
        Object.defineProperty(trx, ROLE, { value: role, enumerable: false, configurable: true });
        return trx as Transaction<R>;
    };

    export const roleOf = (handle: unknown): Role | undefined =>
        (handle as Record<symbol, Role> | null | undefined)?.[ROLE];

    type ActingUser = { userId: UserD.Id };

    /**
     * Runs `fn` as `principal`. Postgres never sees the token, so the identity
     * is handed down here — transaction-local, so it clears on commit and cannot
     * leak to the next request that borrows this pooled connection.
     */
    export async function asUser<T>(
        principal: ActingUser,
        fn: (trx: UserTransaction) => Promise<T>,
    ): Promise<T> {
        return app().transaction().execute(async (trx) => {
            await sql`select set_config('app.user_id', ${principal.userId}, true)`.execute(trx);

            return fn(tag(trx, Role.User));
        });
    }

    /** Runs `fn` with no acting user. `reason` is mandatory so every use is greppable. */
    export async function asService<T>(
        reason: string,
        fn: (trx: ServiceTransaction) => Promise<T>,
    ): Promise<T> {
        void reason;

        return service().transaction().execute((trx) => fn(tag(trx, Role.Service)));
    }

    /** Handle for the migration runner. Migrations run as the owning role. */
    export function forMigrations(): Kysely<Tables> {
        return service();
    }

    export async function destroyPools(): Promise<void> {
        await appDb?.destroy();
        await serviceDb?.destroy();
        appDb = serviceDb = undefined;
    }
}
