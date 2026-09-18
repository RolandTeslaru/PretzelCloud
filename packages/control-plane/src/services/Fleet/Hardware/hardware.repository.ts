import { Injectable } from '@nestjs/common';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { FleetDB } from '@/db/fleet';
import { Repository, Transactional } from '@/db/repository';
import { Principal } from '@/auth/identity/principal';

/** Row operations on `hardware`. */
@Injectable()
export class HardwareRepository extends Repository(FleetDB) {

    /** The driver and the cluster are chosen once. A workspace that already has hardware keeps both. */
    @Transactional('service')
    public async ensureForWorkspace(principal: Principal.Service, workspaceId: Workspace.Id, driver: Fleet.Hardware.Driver, cluster: Fleet.Cluster, releaseId: Fleet.Release.Id) {
        const inserted = await this.trx
            .insertInto('hardware')
            .values({ workspace_id: workspaceId, driver, cluster_id: cluster.id, region: cluster.region, release_id: releaseId })
            .onConflict((oc) => oc.column('workspace_id').doNothing())
            .returningAll()
            .executeTakeFirst();

        if (inserted)
            return FleetDB.Hardware.Row.parse(inserted);

        const existing = await this.trx
            .selectFrom('hardware')
            .selectAll()
            .where('workspace_id', '=', workspaceId)
            .executeTakeFirstOrThrow();

        return FleetDB.Hardware.Row.parse(existing);
    }

    /** The workspace's hardware with its machines, in one read. */
    @Transactional('service')
    public async getByWorkspace(principal: Principal.Service, workspaceId: Workspace.Id): Promise<Fleet.Hardware | undefined> {
        const row = await this.trx
            .selectFrom('hardware')
            .selectAll('hardware')
            .select((eb) => jsonArrayFrom(
                eb.selectFrom('machines')
                    .selectAll('machines')
                    .whereRef('machines.hardware_id', '=', 'hardware.id'),
            ).as('machines'))
            .where('hardware.workspace_id', '=', workspaceId)
            .executeTakeFirst();

        if (!row)
            return undefined;

        const { machines, ...hardware } = row;

        return FleetDB.Hardware.toDomain(
            FleetDB.Hardware.Row.parse(hardware),
            machines.map((machine) => FleetDB.Machine.toDomain(FleetDB.Machine.Row.parse(machine))),
        );
    }

    /** Where each workspace lives and what it runs, for the grid. */
    @Transactional('service')
    public async getHardwareFieldsForWorkspaces(principal: Principal.Service, workspaceIds: Workspace.Id[]) {
        if (workspaceIds.length === 0)
            return [];

        const rows = await this.trx
            .selectFrom('hardware')
            .innerJoin('releases', 'releases.id', 'hardware.release_id')
            .where('hardware.workspace_id', 'in', workspaceIds)
            .select([
                'hardware.workspace_id as workspace_id',
                'hardware.region as region',
                'hardware.driver as driver',
                'releases.id as release_id',
                'releases.name as release_name',
            ])
            .execute();

        return rows.map((row) => ({
            workspaceId: row.workspace_id as Workspace.Id,
            region:      row.region as Fleet.Region.Schema,
            driver:      row.driver as Fleet.Hardware.Driver,
            releaseId:   row.release_id as Fleet.Release.Id,
            releaseName: row.release_name as Fleet.Release.Name,
        }));
    }

    /** Moves the pin: what the next machine build is built from. */
    @Transactional('service')
    public async setRelease(principal: Principal.Service, workspaceId: Workspace.Id, releaseId: Fleet.Release.Id) {
        return this.trx
            .updateTable('hardware')
            .set({ release_id: releaseId })
            .where('workspace_id', '=', workspaceId)
            .execute();
    }

    /** Marks the workspace as used just now. */
    @Transactional('service')
    public async touch(principal: Principal.Service, workspaceId: Workspace.Id) {
        return this.trx
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
    @Transactional('service')
    public async getLastSeen(principal: Principal.Service): Promise<{ workspaceId: Workspace.Id; lastSeenAt: Date }[]> {
        const rows = await this.trx
            .selectFrom('hardware')
            .select(['workspace_id', 'last_seen_at', 'last_boot_at', 'created_at'])
            .execute();

        return rows.map((row) => ({
            workspaceId: row.workspace_id as Workspace.Id,
            lastSeenAt:  row.last_seen_at ?? row.last_boot_at ?? row.created_at,
        }));
    }

    @Transactional('service')
    public async deleteFor(principal: Principal.Service, workspaceId: Workspace.Id) {
        return this.trx.deleteFrom('hardware').where('workspace_id', '=', workspaceId).execute();
    }
}
