import { Injectable } from '@nestjs/common';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { FleetDB } from '@/db/fleet';
import { HostnameDatabase } from './hostname.database';

@Injectable()
export class HostnameService {

    constructor(private readonly hostnameDatabase: HostnameDatabase) {}

    /** The pair every workspace answers at, derived from its id. Never removed. */
    async registerCanonical(workspaceId: Workspace.Id): Promise<void> {
        const canonical = Workspace.Subdomain.canonical(workspaceId);

        await FleetDB.asService('register canonical hostnames', (trx) =>
            this.hostnameDatabase.register(trx, workspaceId, Fleet.Hostname.Host.createAll(canonical)));
    }

    /**
     * Replaces the custom pair, leaving the canonical one alone. Null clears it.
     * Deleting before inserting means a workspace is never briefly reachable at
     * two different custom names.
     */
    async setCustom(workspaceId: Workspace.Id, subdomain: Workspace.Subdomain | null): Promise<void> {
        const canonical = Workspace.Subdomain.canonical(workspaceId);
        const keep = Fleet.Hostname.Host.createAll(canonical).map((entry) => entry.host);

        await FleetDB.asService('set custom hostnames', async (trx) => {
            await this.hostnameDatabase.clearExcept(trx, workspaceId, keep);

            if (subdomain)
                await this.hostnameDatabase.register(trx, workspaceId, Fleet.Hostname.Host.createAll(subdomain));
        });
    }

    async delete(workspaceId: Workspace.Id): Promise<void> {
        await FleetDB.asService('delete hostnames', (trx) => this.hostnameDatabase.deleteFor(trx, workspaceId));
    }
}
