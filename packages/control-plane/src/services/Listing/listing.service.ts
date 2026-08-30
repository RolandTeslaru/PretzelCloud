import { Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { Listing, Workspace } from '@pretzel-cloud/shared/domain';
import { Principal } from '@/auth/identity/principal';
import { ListingRepository } from './listing.repository';

// One row per listing — the owner's current active publication.
@Injectable()
export class ListingService {

    constructor(private readonly listingRepository: ListingRepository) {}


    public async get(id: Listing.Id): Promise<Listing> {
        const workflow = await this.listingRepository.find(Principal.SELF, id);

        if (!workflow)
            throw new NotFoundException('No such listing');

        return workflow;
    }

    // Missing ids are simply absent.
    public async getUpdates(ids: Listing.Id[]): Promise<Record<Listing.Id, Listing.Data>> {
        if (ids.length === 0)
            return {};

        return this.listingRepository.getUpdates(Principal.SELF, ids);
    }

    public async put(principal: Principal.Silo, request: Listing.API.Put.Request): Promise<Listing.Id> {
        if (Buffer.byteLength(JSON.stringify(request.workflowData)) > Listing.MAX_DATA_BYTES)
            throw new PayloadTooLargeException(`Workflow data exceeds ${Listing.MAX_DATA_BYTES} bytes`);

        if (!request.id)
            return this.listingRepository.insert(principal, request);

        const updated = await this.listingRepository.update(principal, request.id, request);

        if (updated === 0)
            throw new NotFoundException('No such listing');

        return request.id;
    }

    public async deleteAllForWorkspace(workspaceId: Workspace.Id): Promise<void> {
        await this.listingRepository.deleteAllForWorkspace(Principal.SELF, workspaceId);
    }

    public async delete(principal: Principal.Silo, id: Listing.Id): Promise<void> {
        const deleted = await this.listingRepository.delete(principal, id);

        if (deleted === 0)
            throw new NotFoundException('No such listing');
    }

}
