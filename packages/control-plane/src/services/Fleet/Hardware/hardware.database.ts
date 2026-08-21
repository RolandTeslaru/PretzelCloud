import { Injectable } from '@nestjs/common';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { FleetDB } from '@/db/fleet';

type Trx = FleetDB.Transaction;

/** Row operations on `hardware`. */
@Injectable()
export class HardwareDatabase {

    async insert(trx: Trx, workspaceId: Workspace.Id, driver: Fleet.Hardware.Driver) {
        const row = await trx
            .insertInto('hardware')
            .values({ workspace_id: workspaceId, driver })
            .onConflict((oc) => oc.column('workspace_id').doUpdateSet({ driver }))
            .returningAll()
            .executeTakeFirstOrThrow();

        return FleetDB.Hardware.Row.parse(row);
    }

    async getByWorkspace(trx: Trx, workspaceId: Workspace.Id) {
        const row = await trx
            .selectFrom('hardware')
            .selectAll()
            .where('workspace_id', '=', workspaceId)
            .executeTakeFirst();

        return row ? FleetDB.Hardware.Row.parse(row) : undefined;
    }

    /** Marks the workspace as used just now. */
    touch(trx: Trx, workspaceId: Workspace.Id) {
        return trx
            .updateTable('hardware')
            .set({ last_seen_at: new Date() })
            .where('workspace_id', '=', workspaceId)
            .execute();
    }

    /**
     * When each workspace was last used, for deciding what to do with the ones
     * that have not been. Falls back to when the hardware was made, so a
     * workspace nobody has visited yet still has an age.
     */
    async getLastSeen(trx: Trx): Promise<{ workspaceId: Workspace.Id; lastSeenAt: Date }[]> {
        const rows = await trx
            .selectFrom('hardware')
            .select(['workspace_id', 'last_seen_at', 'last_boot_at', 'created_at'])
            .execute();

        return rows.map((row) => ({
            workspaceId: Workspace.Id.parse(row.workspace_id),
            lastSeenAt:  row.last_seen_at ?? row.last_boot_at ?? row.created_at,
        }));
    }

    deleteFor(trx: Trx, workspaceId: Workspace.Id) {
        return trx.deleteFrom('hardware').where('workspace_id', '=', workspaceId).execute();
    }
}
