import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Workspace } from '@pretzel-cloud/shared/domain';
import { FleetDB } from '@/db/fleet';

type Trx = FleetDB.Transaction;

/** Row operations on `workspace_usage`, grouped by what was used. */
@Injectable()
export class UsageDatabase {

    public readonly executions = {

        /**
         * Records one and answers with the period's total, in one round trip.
         * The insert is added on: a data-modifying CTE shares the statement's
         * snapshot, so the count alone would not see the row just written.
         */
        insertAndGetCount: async (trx: Trx, values: {
            workspaceId: Workspace.Id;
            executionId: string | null;
            igniter:     string | null;
            period:      Workspace.Usage.Period;
        }): Promise<number> => {
            const result = await sql<{ count: string }>`
                with recorded as (
                    insert into workspace_usage (workspace_id, execution_id, igniter)
                    values (${values.workspaceId}, ${values.executionId}, ${values.igniter})
                    on conflict (workspace_id, execution_id) where execution_id is not null
                    do nothing
                    returning 1
                )
                select (
                    select count(*)
                    from workspace_usage
                    where workspace_id = ${values.workspaceId}
                      and created_at  >= ${values.period.start}
                      and (${values.period.end}::timestamptz is null or created_at < ${values.period.end})
                ) + (select count(*) from recorded) as count
            `.execute(trx);

            return Number(result.rows[0]?.count ?? 0);
        },

        /** How many one workspace recorded in a period. */
        getCountIn: async (trx: Trx, workspaceId: Workspace.Id, period: Workspace.Usage.Period): Promise<number> => {
            let query = trx
                .selectFrom('workspace_usage')
                .select(({ fn }) => fn.countAll<string>().as('count'))
                .where('workspace_id', '=', workspaceId)
                .where('created_at', '>=', period.start);

            if (period.end)
                query = query.where('created_at', '<', period.end);

            const row = await query.executeTakeFirstOrThrow();

            return Number(row.count);
        },

        /** The same for many, grouped by workspace. */
        getCountsIn: async (trx: Trx, workspaceIds: Workspace.Id[], period: Workspace.Usage.Period) => {
            if (workspaceIds.length === 0)
                return [];

            let query = trx
                .selectFrom('workspace_usage')
                .select(({ fn }) => ['workspace_id', fn.countAll<string>().as('count')])
                .where('workspace_id', 'in', workspaceIds)
                .where('created_at', '>=', period.start);

            if (period.end)
                query = query.where('created_at', '<', period.end);

            return query.groupBy('workspace_id').execute();
        },

        /** The rows behind one workspace's count, newest first. */
        getIn: async (trx: Trx, workspaceId: Workspace.Id, period: Workspace.Usage.Period, limit: number): Promise<Workspace.Usage[]> => {
            let query = trx
                .selectFrom('workspace_usage')
                .selectAll()
                .where('workspace_id', '=', workspaceId)
                .where('created_at', '>=', period.start);

            if (period.end)
                query = query.where('created_at', '<', period.end);

            const rows = await query
                .orderBy('created_at', 'desc')
                .limit(limit)
                .execute();

            return rows.map((row) => FleetDB.Usage.toDomain(FleetDB.Usage.Row.parse(row)));
        },

        /** One row per day that saw an execution, oldest first. */
        getDailyCounts: async (trx: Trx, workspaceId: Workspace.Id, period: Workspace.Usage.Period): Promise<Workspace.Usage.Point[]> => {
            const result = await sql<{ day: Date; count: string }>`
                select date_trunc('day', created_at) as day, count(*) as count
                from workspace_usage
                where workspace_id = ${workspaceId}
                  and created_at  >= ${period.start}
                  and (${period.end}::timestamptz is null or created_at < ${period.end})
                group by 1
                order by 1
            `.execute(trx);

            return result.rows.map((row) => ({ day: new Date(row.day), count: Number(row.count) }));
        },

        /** Newest first, for the overview. */
        getRecent: async (trx: Trx, workspaceIds: Workspace.Id[], limit: number) => {
            if (workspaceIds.length === 0)
                return [];

            const rows = await trx
                .selectFrom('workspace_usage')
                .selectAll()
                .where('workspace_id', 'in', workspaceIds)
                .orderBy('created_at', 'desc')
                .limit(limit)
                .execute();

            return rows.map((row) => FleetDB.Usage.toDomain(FleetDB.Usage.Row.parse(row)));
        },
    };
}
