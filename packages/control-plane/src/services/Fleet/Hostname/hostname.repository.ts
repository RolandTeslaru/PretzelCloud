import { Injectable } from '@nestjs/common';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { FleetDB } from '@/db/fleet';
import { Repository, Transactional } from '@/db/repository';
import { Principal } from '@/auth/identity/principal';

type Entry = { host: Fleet.Hostname.Host; kind: Fleet.Hostname.Kind };

/** Row operations on `hostnames`. */
@Injectable()
export class HostnameRepository extends Repository(FleetDB) {

    @Transactional('service')
    public async register(principal: Principal.Service, workspaceId: Workspace.Id, entries: Entry[]): Promise<void> {
        await this._insert(workspaceId, entries);
    }

    /**
     * Replaces everything but `keep` with `entries`, atomically. Deleting before
     * inserting means a workspace is never briefly reachable at two names.
     */
    @Transactional('service')
    public async replaceExcept(principal: Principal.Service, workspaceId: Workspace.Id, keep: Fleet.Hostname.Host[], entries: Entry[]): Promise<void> {
        await this.trx
            .deleteFrom('hostnames')
            .where('workspace_id', '=', workspaceId)
            .where('host', 'not in', keep)
            .execute();

        if (entries.length > 0)
            await this._insert(workspaceId, entries);
    }

    @Transactional('service')
    public async deleteFor(principal: Principal.Service, workspaceId: Workspace.Id): Promise<void> {
        await this.trx
            .deleteFrom('hostnames')
            .where('workspace_id', '=', workspaceId)
            .execute();
    }

    private async _insert(workspaceId: Workspace.Id, entries: Entry[]): Promise<void> {
        await this.trx
            .insertInto('hostnames')
            .values(entries.map((entry) => ({ ...entry, workspace_id: workspaceId })))
            .onConflict((oc) => oc.column('host').doNothing())
            .execute();
    }
}
