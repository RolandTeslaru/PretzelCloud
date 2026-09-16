import { z } from 'zod';
import { Kysely, PostgresDialect, sql, Transaction as KyselyTransaction } from 'kysely';
import { Pool } from 'pg';
import {
    Fleet,
    Plan      as PlanD,
    Listing   as ListingD,
    User      as UserD,
    Workspace as WorkspaceD,
} from '@pretzel-cloud/shared/domain';
import { Table, Stamps, requireEnv } from '../table';

// pg closes an idle connection after 10 s by default, and a router mostly idles between requests.
const IDLE_CONNECTION_MS = 10 * 60_000;

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
            id:                 UserD.Id,
            email:              z.string(),
            username:           z.string(),
            display_name:       z.string(),
            avatar_url:         z.string().nullable(),
            stripe_customer_id: z.string().nullable(),
            is_admin:           z.boolean(),
            created_at:         z.coerce.date(),
            updated_at:         z.coerce.date(),
        });
        export type Row = z.infer<typeof Row>;

        export const toDomain = (row: Row) => UserD.Schema.parse({
            id:          row.id,
            email:       row.email,
            username:    row.username,
            displayName: row.display_name,
            avatarUrl:   row.avatar_url,
            isAdmin:     row.is_admin,
            createdAt:   row.created_at,
            updatedAt:   row.updated_at,
        });
    }

    export namespace Workspace {
        export const Row = z.object({
            id:           WorkspaceD.Id,
            owner_id:     UserD.Id,
            subdomain:    z.string().nullable(),
            display_name: z.string(),
            plan_id:      PlanD.Id,

            disabled_at:     z.coerce.date().nullable(),
            disabled_reason: z.string().nullable(),
            abandoned_at:    z.coerce.date().nullable(),
            lifecycle_state: WorkspaceD.Lifecycle.State,

            stripe_subscription_id: z.string().nullable(),
            subscription_status:    z.string().nullable(),
            current_period_start:   z.coerce.date().nullable(),
            current_period_end:     z.coerce.date().nullable(),

            created_at: z.coerce.date(),
            updated_at: z.coerce.date(),
        });
        export type Row = z.infer<typeof Row>;

        export const toDomain = (row: Row, plan: PlanD) => WorkspaceD.Schema.parse({
            id:                 row.id,
            subdomain:          row.subdomain,
            displayName:        row.display_name,
            lifecycleState:     row.lifecycle_state,
            disabledReason:     row.disabled_reason,
            plan,
            // The fleet's facts, filled at the API seam by whoever lists.
            region:             null,
            releaseId:          null,
            releaseName:        null,
            subscriptionStatus: row.subscription_status,
            currentPeriodStart: row.current_period_start,
            currentPeriodEnd:   row.current_period_end,
            ownerId:            row.owner_id,
            appUrl:             Fleet.Hostname.Host.getOrigin(WorkspaceD.Subdomain.canonical(row.id), 'app'),
            createdAt:          row.created_at,
            updatedAt:          row.updated_at,
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

    export namespace Plan {
        export const Row = z.object({
            id:                               PlanD.Id,
            description:                      z.string(),
            display_name:                     z.string(),
            price_cents:                      z.number().int(),
            currency:                         z.string(),
            stripe_price_id:                  z.string().nullable(),
            stripe_product_id:                z.string().nullable(),
            backend_size:                     z.string(),
            idle_backend_policy:              PlanD.IdleBackendPolicy,
            worker_count:                     z.number().int(),
            worker_size:                      z.string().nullable(),
            worker_concurrency:               z.number().int(),
            max_workflows:                    z.number().int().nullable(),
            max_executions_monthly:           z.number().int().nullable(),
            max_workspace_members:            z.number().int().nullable(),
            max_uptime_hours_monthly:         z.number().int().nullable(),
            execution_session_retention_days: z.number().int().nullable(),
            purchasable:                      z.boolean(),
            sort_order:                       z.number().int(),
            created_at:                       z.coerce.date(),
            updated_at:                       z.coerce.date(),
        });
        export type Row = z.infer<typeof Row>;

        export const toDomain = (row: Row) => PlanD.Schema.parse({
            id:                            row.id,
            displayName:                   row.display_name,
            description:                   row.description,
            priceCents:                    row.price_cents,
            currency:                      row.currency,
            stripePriceId:                 row.stripe_price_id,
            stripeProductId:               row.stripe_product_id,
            backendSize:                   row.backend_size,
            idleBackendPolicy:             row.idle_backend_policy,
            workerCount:                   row.worker_count,
            workerSize:                    row.worker_size,
            workerConcurrency:             row.worker_concurrency,
            maxWorkflows:                  row.max_workflows,
            maxExecutionsMonthly:          row.max_executions_monthly,
            maxWorkspaceMembers:           row.max_workspace_members,
            maxUptimeHoursMonthly:         row.max_uptime_hours_monthly,
            executionSessionRetentionDays: row.execution_session_retention_days,
            purchasable:                   row.purchasable,
            sortOrder:                     row.sort_order,
            createdAt:                     row.created_at,
            updatedAt:                     row.updated_at,
        });
    }

    // Events already acted on. Stripe retries until it gets a 2xx, so the same
    // one arrives more than once.
    export namespace StripeEvent {
        export const Row = z.object({
            id:          z.string(),
            received_at: z.coerce.date(),
        });
        export type Row = z.infer<typeof Row>;
    }

    export namespace Listing {
        export const Row = z.object({
            id:               ListingD.Id,
            workspace_id:     WorkspaceD.Id,
            workflow_id:      ListingD.WorkflowId,
            publication_meta: ListingD.Data,
            workflow_data:    ListingD.Data,
            blueprint_id:     z.string().nullable(),
            created_at:       z.coerce.date(),
            updated_at:       z.coerce.date(),
        });
        export type Row = z.infer<typeof Row>;

        export const toDomain = (row: Row) => ListingD.Schema.parse({
            id:              row.id,
            workspaceId:     row.workspace_id,
            workflowId:      row.workflow_id,
            publicationMeta: row.publication_meta,
            workflowData:    row.workflow_data,
            blueprintId:     row.blueprint_id,
            createdAt:       row.created_at,
            updatedAt:       row.updated_at,
        });
    }

    export interface Tables {
        users:             Table<typeof User.Row, Stamps | 'is_admin'>;
        workspaces:        Table<typeof Workspace.Row, Stamps | 'lifecycle_state' | 'disabled_at' | 'disabled_reason' | 'abandoned_at'>;
        workspace_members: Table<typeof Member.Row, 'created_at'>;
        stripe_events:     Table<typeof StripeEvent.Row, 'received_at'>;
        plans:             Table<typeof Plan.Row, Stamps>;
        listings:          Table<typeof Listing.Row, 'blueprint_id' | 'created_at' | 'updated_at'>;
    }

    function connect(urlEnvVar: string): Kysely<Tables> {
        return new Kysely<Tables>({
            dialect: new PostgresDialect({
                // Idle connections stay open: opening one to Neon costs more than most queries.
                pool: new Pool({ connectionString: requireEnv(urlEnvVar), max: 10, idleTimeoutMillis: IDLE_CONNECTION_MS, keepAlive: true }),
            }),
        });
    }

    // Lazy so importing this module cannot crash a process that has not been
    // configured for it, and so env is read after it has been loaded.
    let appDb: Kysely<Tables> | undefined;
    let serviceDb: Kysely<Tables> | undefined;

    const app     = () => (appDb     ??= connect('PORTAL_DATABASE_URL_APP'));
    const service = () => (serviceDb ??= connect('PORTAL_DATABASE_URL_SERVICE'));

    export const Role = { User: 'user', Silo: 'silo', Service: 'service' } as const;
    export type  Role = typeof Role[keyof typeof Role];

    /**
     * A transaction, branded with the identity it runs as. No default on `R` —
     * a signature must state which roles it accepts, so the permissive form
     * costs more to write than the safe one.
     */
    export type Transaction<R extends Role> = KyselyTransaction<Tables> & { readonly __as: R };

    export type UserTransaction    = Transaction<typeof Role.User>;
    export type SiloTransaction    = Transaction<typeof Role.Silo>;
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

    type ActingSilo = { workspaceId: WorkspaceD.Id };

    /** Runs `fn` as the silo SiloAuthGuard proved; RLS bounds it to that workspace's rows. */
    export async function asSilo<T>(
        principal: ActingSilo,
        fn: (trx: SiloTransaction) => Promise<T>,
    ): Promise<T> {
        return app().transaction().execute(async (trx) => {
            await sql`select set_config('app.workspace_id', ${principal.workspaceId}, true)`.execute(trx);

            return fn(tag(trx, Role.Silo));
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
