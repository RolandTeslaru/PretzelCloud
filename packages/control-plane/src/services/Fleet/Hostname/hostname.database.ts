import { Injectable } from '@nestjs/common';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { FleetDB } from '@/db/fleet';

type Trx = FleetDB.Transaction;

/** Row operations on `hostnames`. */
@Injectable()
export class HostnameDatabase {

    register(trx: Trx, workspaceId: Workspace.Id, entries: { host: Fleet.Hostname.Host; kind: Fleet.Hostname.Kind }[]) {
        return trx
            .insertInto('hostnames')
            .values(entries.map((entry) => ({ ...entry, workspace_id: workspaceId })))
            .onConflict((oc) => oc.column('host').doNothing())
            .execute();
    }

    clearExcept(trx: Trx, workspaceId: Workspace.Id, keep: Fleet.Hostname.Host[]) {
        return trx
            .deleteFrom('hostnames')
            .where('workspace_id', '=', workspaceId)
            .where('host', 'not in', keep)
            .execute();
    }

    deleteFor(trx: Trx, workspaceId: Workspace.Id) {
        return trx.deleteFrom('hostnames').where('workspace_id', '=', workspaceId).execute();
    }
}
