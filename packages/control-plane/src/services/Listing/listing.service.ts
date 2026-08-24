import { Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { Listing, Workspace } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';
import { Principal } from '@/auth/identity/principal';
import { ListingDatabase } from './listing.database';

// One row per listing — the owner's current active publication.
@Injectable()
export class ListingService {

    constructor(private readonly listingsDb: ListingDatabase) {}


    public async get(id: Listing.Id): Promise<Listing> {
        const workflow = await PortalDB.asService('read listing', (trx) => this.listingsDb.find(trx, id));

        if (!workflow)
            throw new NotFoundException('No such listing');

        return workflow;
    }

    // Missing ids are simply absent.
    public async getUpdates(ids: Listing.Id[]): Promise<Record<Listing.Id, Listing.Data>> {
        if (ids.length === 0)
            return {};

        return PortalDB.asService('check listing updates', (trx) => this.listingsDb.getUpdates(trx, ids));
    }

    public async put(principal: Principal.Silo, request: Listing.API.Put.Request): Promise<Listing.Id> {
        if (Buffer.byteLength(JSON.stringify(request.workflowData)) > Listing.MAX_DATA_BYTES)
            throw new PayloadTooLargeException(`Workflow data exceeds ${Listing.MAX_DATA_BYTES} bytes`);

        return PortalDB.asSilo(principal, async (trx) => {
            if (!request.id)
                return this.listingsDb.insert(trx, principal.workspaceId, request);

            const updated = await this.listingsDb.update(trx, request.id, principal.workspaceId, request);

            if (updated === 0)
                throw new NotFoundException('No such listing');

            return request.id;
        });
    }

    public async deleteAllForWorkspace(workspaceId: Workspace.Id): Promise<void> {
        await PortalDB.asService('delete destroyed workspace listings', (trx) => this.listingsDb.deleteAllForWorkspace(trx, workspaceId));
    }

    public async delete(principal: Principal.Silo, id: Listing.Id): Promise<void> {
        const deleted = await PortalDB.asSilo(principal, (trx) => this.listingsDb.delete(trx, id));

        if (deleted === 0)
            throw new NotFoundException('No such listing');
    }

}
