import { Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { Listing, Workspace } from '@pretzel-cloud/shared/domain';
import { Principal } from '@/auth/identity/principal';
import { ListingRepository } from './listing.repository';

// A listed workflow and its versions: one per PretzelGraph release step, resolved for each caller's release.
@Injectable()
export class ListingService {

    constructor(private readonly listingRepository: ListingRepository) {}


    public async get(id: Listing.Id, release: Listing.Release): Promise<Listing> {
        const workflow = await this.listingRepository.find(Principal.SELF, id, release);

        if (!workflow)
            throw new NotFoundException('No such listing');

        return workflow;
    }

    // Missing ids, and ids with no version the release can run, are simply absent.
    public async getUpdates(ids: Listing.Id[], release: Listing.Release): Promise<Record<Listing.Id, Listing.Data>> {
        return this.listingRepository.getUpdates(Principal.SELF, ids, release);
    }

    public async getOwnedIds(principal: Principal.Silo): Promise<Record<Listing.WorkflowId, Listing.Id>> {
        return this.listingRepository.getOwnedIds(principal);
    }

    // Lists the workflow, or lists it again under the same id, with this publication as a version.
    public async share(principal: Principal.Silo, workflowId: Listing.WorkflowId, request: Listing.API.Put.Request): Promise<Listing.Id> {
        this.assertSize(request);

        return this.listingRepository.share(principal, workflowId, request);
    }

    // Writes a version of a workflow that is already listed; otherwise not found.
    public async writeVersion(principal: Principal.Silo, workflowId: Listing.WorkflowId, request: Listing.API.Put.Request): Promise<Listing.Id> {
        this.assertSize(request);

        const id = await this.listingRepository.writeVersion(principal, workflowId, request);

        if (!id)
            throw new NotFoundException('Workflow is not listed');

        return id;
    }

    public async deleteAllForWorkspace(workspaceId: Workspace.Id): Promise<void> {
        await this.listingRepository.deleteAllForWorkspace(Principal.SELF, workspaceId);
    }

    // Idempotent: withdrawing an unlisted workflow is a no-op.
    public async withdraw(principal: Principal.Silo, workflowId: Listing.WorkflowId): Promise<void> {
        await this.listingRepository.withdraw(principal, workflowId);
    }

    private assertSize(request: Listing.API.Put.Request): void {
        if (Buffer.byteLength(JSON.stringify(request.workflowData)) > Listing.MAX_DATA_BYTES)
            throw new PayloadTooLargeException(`Workflow data exceeds ${Listing.MAX_DATA_BYTES} bytes`);
    }

}
