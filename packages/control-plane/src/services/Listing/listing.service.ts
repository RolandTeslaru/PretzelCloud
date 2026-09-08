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

    public async getOwnedIds(principal: Principal.Silo): Promise<Record<Listing.WorkflowId, Listing.Id>> {
        return this.listingRepository.getOwnedIds(principal);
    }

    public async upsert(principal: Principal.Silo, workflowId: Listing.WorkflowId, request: Listing.API.Put.Request): Promise<Listing.Id> {
        this.assertSize(request);

        return this.listingRepository.upsert(principal, workflowId, request);
    }

    // Replaces the copy of a workflow that is already listed; otherwise not found.
    public async update(principal: Principal.Silo, workflowId: Listing.WorkflowId, request: Listing.API.Put.Request): Promise<Listing.Id> {
        this.assertSize(request);

        const id = await this.listingRepository.update(principal, workflowId, request);

        if (!id)
            throw new NotFoundException('Workflow is not listed');

        return id;
    }

    public async deleteAllForWorkspace(workspaceId: Workspace.Id): Promise<void> {
        await this.listingRepository.deleteAllForWorkspace(Principal.SELF, workspaceId);
    }

    // Idempotent: withdrawing an unlisted workflow is a no-op.
    public async deleteByWorkflow(principal: Principal.Silo, workflowId: Listing.WorkflowId): Promise<void> {
        await this.listingRepository.deleteByWorkflow(principal, workflowId);
    }

    private assertSize(request: Listing.API.Put.Request): void {
        if (Buffer.byteLength(JSON.stringify(request.workflowData)) > Listing.MAX_DATA_BYTES)
            throw new PayloadTooLargeException(`Workflow data exceeds ${Listing.MAX_DATA_BYTES} bytes`);
    }

}
