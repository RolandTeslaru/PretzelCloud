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

    deleteFor(trx: Trx, workspaceId: Workspace.Id) {
        return trx.deleteFrom('hardware').where('workspace_id', '=', workspaceId).execute();
    }
}
