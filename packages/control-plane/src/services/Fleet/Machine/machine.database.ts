import { Injectable } from '@nestjs/common';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { FleetDB } from '@/db/fleet';

type Trx = FleetDB.Transaction;

/** Row operations on `machines`. */
@Injectable()
export class MachineDatabase {

    async getAll(trx: Trx, workspaceId: Workspace.Id): Promise<Fleet.Machine[]> {
        const rows = await trx
            .selectFrom('machines')
            .selectAll()
            .where('workspace_id', '=', workspaceId)
            .execute();

        return rows.map((row) => FleetDB.Machine.toDomain(FleetDB.Machine.Row.parse(row)));
    }

    /** One role's machine, for callers that want a single one rather than all. */
    async getByRole(trx: Trx, workspaceId: Workspace.Id, roles: Fleet.Machine.Role[]): Promise<Fleet.Machine | undefined> {
        const row = await trx
            .selectFrom('machines')
            .selectAll()
            .where('workspace_id', '=', workspaceId)
            .where('role', 'in', roles)
            .executeTakeFirst();

        return row ? FleetDB.Machine.toDomain(FleetDB.Machine.Row.parse(row)) : undefined;
    }

    /** Non-destroyed states for many workspaces, with the role that owns each. */
    getStatesByWorkspaces(trx: Trx, workspaceIds: Workspace.Id[]) {
        return trx
            .selectFrom('machines')
            .select(['workspace_id', 'role', 'state'])
            .where('workspace_id', 'in', workspaceIds)
            .where('state', '!=', 'destroyed')
            .execute();
    }

    getIdsByWorkspace(trx: Trx, workspaceId: Workspace.Id) {
        return trx.selectFrom('machines').select('id').where('workspace_id', '=', workspaceId).execute();
    }

    insert(trx: Trx, values: {
        workspace_id: Workspace.Id;
        hardware_id:  Fleet.Hardware.Id;
        driver:       Fleet.Driver;
        external_id:  Fleet.Machine.ResourceId;
        role:         Fleet.Machine.Role;
        size:         string;
        state:        Fleet.Machine.State;
    }) {
        return trx
            .insertInto('machines')
            .values({ ...values, last_boot_at: new Date(), last_seen_at: null })
            // The unique index on (workspace_id, role) makes a re-run land here
            // rather than creating a second machine.
            .onConflict((oc) => oc
                .columns(['workspace_id', 'role'])
                .doUpdateSet({ external_id: values.external_id, state: values.state, hardware_id: values.hardware_id, driver: values.driver }))
            .execute();
    }

    setState(trx: Trx, id: Fleet.Machine.Id, state: Fleet.Machine.State) {
        return trx
            .updateTable('machines')
            .set({ state, last_seen_at: new Date() })
            .where('id', '=', id)
            .execute();
    }

    deleteById(trx: Trx, id: Fleet.Machine.Id) {
        return trx.deleteFrom('machines').where('id', '=', id).execute();
    }

    deleteFor(trx: Trx, workspaceId: Workspace.Id) {
        return trx.deleteFrom('machines').where('workspace_id', '=', workspaceId).execute();
    }
}
