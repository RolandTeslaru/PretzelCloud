import { Controller, Delete, Get, Patch, Put, Query, UseGuards } from '@nestjs/common';
import { Listing } from '@pretzel-cloud/shared/domain';
import { SiloAuthGuard } from '@/auth/guards/silo-auth.guard';
import { AuthenticatedSilo } from '@/auth/identity/principal.decorator';
import { Principal } from '@/auth/identity/principal';
import { ZodBody, ZodParam } from '@pretzel-cloud/shared/server/pipes/zod.pipe';
import { ListingService } from './listing.service';

// The registry surface: open reads, silo writes.
@Controller()
export class ListingController {

    constructor(private readonly listingService: ListingService) {}


    // Open side: no session, no token.

    // Before :id, or the literal would be parsed as one.
    @Get('listings/updates')
    public async updates(@Query() query: unknown): Promise<Listing.API.Updates.Response> {
        const { ids, release } = Listing.API.Updates.Request.parse(query);

        return { updates: await this.listingService.getUpdates(ids, release) };
    }

    @Get('listings/:id')
    public async get(
        @ZodParam('id', Listing.Id) id:    Listing.Id,
        @Query()                    query: unknown,
    ): Promise<Listing.API.Get.Response> {
        const { release } = Listing.API.ReleaseQuery.parse(query);

        return { workflow: await this.listingService.get(id, release) };
    }

    // Writing side: a silo sharing, refreshing or withdrawing its own workflows.

    @Get('workspaces/:workspaceId/listings')
    @UseGuards(SiloAuthGuard)
    public async owned(@AuthenticatedSilo() workspace: Principal.Silo): Promise<Listing.API.Owned.Response> {
        return { listings: await this.listingService.getOwnedIds(workspace) };
    }

    @Put('workspaces/:workspaceId/listings/:workflowId')
    @UseGuards(SiloAuthGuard)
    public async put(
        @AuthenticatedSilo()                        workspace:  Principal.Silo,
        @ZodParam('workflowId', Listing.WorkflowId) workflowId: Listing.WorkflowId,
        @ZodBody(Listing.API.Put.Request)           body:       Listing.API.Put.Request,
    ): Promise<Listing.API.Put.Response> {
        const id = await this.listingService.share(workspace, workflowId, body);

        return { id };
    }

    @Patch('workspaces/:workspaceId/listings/:workflowId')
    @UseGuards(SiloAuthGuard)
    public async patch(
        @AuthenticatedSilo()                        workspace:  Principal.Silo,
        @ZodParam('workflowId', Listing.WorkflowId) workflowId: Listing.WorkflowId,
        @ZodBody(Listing.API.Put.Request)           body:       Listing.API.Put.Request,
    ): Promise<Listing.API.Put.Response> {
        const id = await this.listingService.writeVersion(workspace, workflowId, body);

        return { id };
    }

    @Delete('workspaces/:workspaceId/listings/:workflowId')
    @UseGuards(SiloAuthGuard)
    public async delete(
        @AuthenticatedSilo()                        workspace:  Principal.Silo,
        @ZodParam('workflowId', Listing.WorkflowId) workflowId: Listing.WorkflowId,
    ): Promise<Record<string, never>> {
        await this.listingService.withdraw(workspace, workflowId);

        return {};
    }
}
