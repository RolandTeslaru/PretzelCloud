import { Injectable } from '@nestjs/common';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { FleetDB } from '@/db/fleet';
import { Repository, Transactional } from '@/db/repository';
import { Principal } from '@/auth/identity/principal';

/** Row operations on `machines`. */
@Injectable()
export class MachineRepository extends Repository(FleetDB) {

    @Transactional('service')
    public async getAll(principal: Principal.Service, workspaceId: Workspace.Id): Promise<Fleet.Machine[]> {
        const rows = await this.trx
            .selectFrom('machines')
            .selectAll()
            .where('workspace_id', '=', workspaceId)
            .execute();

        return rows.map((row) => FleetDB.Machine.toDomain(FleetDB.Machine.Row.parse(row)));
    }

    /** One role's machine, for callers that want a single one rather than all. */
    @Transactional('service')
    public async getByRole(principal: Principal.Service, workspaceId: Workspace.Id, roles: Fleet.Machine.Role[]): Promise<Fleet.Machine | undefined> {
        const row = await this.trx
            .selectFrom('machines')
            .selectAll()
            .where('workspace_id', '=', workspaceId)
            .where('role', 'in', roles)
            .executeTakeFirst();

        return row ? FleetDB.Machine.toDomain(FleetDB.Machine.Row.parse(row)) : undefined;
    }

    /** Non-destroyed states for many workspaces, with the role that owns each. */
    @Transactional('service')
    public async getStatesByWorkspaces(principal: Principal.Service, workspaceIds: Workspace.Id[]) {
        return this.trx
            .selectFrom('machines')
            .select(['workspace_id', 'role', 'state'])
            .where('workspace_id', 'in', workspaceIds)
            .where('state', '!=', 'destroyed')
            .execute();
    }

    @Transactional('service')
    public async getIdsByWorkspace(principal: Principal.Service, workspaceId: Workspace.Id) {
        return this.trx.selectFrom('machines').select('id').where('workspace_id', '=', workspaceId).execute();
    }

    @Transactional('service')
    public async insert(principal: Principal.Service, values: {
        workspace_id: Workspace.Id;
        hardware_id:  Fleet.Hardware.Id;
        driver:       Fleet.Driver.Kind;
        external_id:  Fleet.Machine.ResourceId;
        role:         Fleet.Machine.Role;
        size:         string;
        state:        Fleet.Machine.State;
    }) {
        return this.trx
            .insertInto('machines')
            .values({ ...values, last_boot_at: new Date(), last_seen_at: null })
            // The unique index on (workspace_id, role) makes a re-run land here
            // rather than creating a second machine.
            .onConflict((oc) => oc
                .columns(['workspace_id', 'role'])
                .doUpdateSet({ external_id: values.external_id, state: values.state, hardware_id: values.hardware_id, driver: values.driver }))
            .execute();
    }

    @Transactional('service')
    public async setState(principal: Principal.Service, id: Fleet.Machine.Id, state: Fleet.Machine.State) {
        return this.trx
            .updateTable('machines')
            .set({ state, last_seen_at: new Date() })
            .where('id', '=', id)
            .execute();
    }

    @Transactional('service')
    public async deleteById(principal: Principal.Service, id: Fleet.Machine.Id) {
        return this.trx.deleteFrom('machines').where('id', '=', id).execute();
    }

    @Transactional('service')
    public async deleteFor(principal: Principal.Service, workspaceId: Workspace.Id) {
        return this.trx.deleteFrom('machines').where('workspace_id', '=', workspaceId).execute();
    }
}
