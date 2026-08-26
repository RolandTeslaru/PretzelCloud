import { Body, Controller, Delete, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { Listing } from '@pretzel-cloud/shared/domain';
import { SiloAuthGuard } from '@/auth/guards/silo-auth.guard';
import { AuthenticatedSilo } from '@/auth/identity/principal.decorator';
import { Principal } from '@/auth/identity/principal';
import { ListingService } from './listing.service';

// The registry surface: open reads, silo writes.
@Controller()
export class ListingController {

    constructor(private readonly listingService: ListingService) {}


    // Open side: no session, no token.

    // Before :id, or the literal would be parsed as one.
    @Get('listings/updates')
    public async updates(@Query() query: unknown): Promise<Listing.API.Updates.Response> {
        const { ids } = Listing.API.Updates.Request.parse(query);

        return { updates: await this.listingService.getUpdates(ids) };
    }

    @Get('listings/:id')
    public async get(@Param('id') id: string): Promise<Listing.API.Get.Response> {
        return { workflow: await this.listingService.get(Listing.Id.parse(id)) };
    }

    // Writing side: a silo sharing or withdrawing its own workflows.

    @Put('workspaces/:workspaceId/listings')
    @UseGuards(SiloAuthGuard)
    public async put(
        @AuthenticatedSilo() workspace: Principal.Silo,
        @Body() body: unknown,
    ): Promise<Listing.API.Put.Response> {
        const id = await this.listingService.put(workspace, Listing.API.Put.Request.parse(body));

        return { id };
    }

    @Delete('workspaces/:workspaceId/listings/:id')
    @UseGuards(SiloAuthGuard)
    public async delete(
        @AuthenticatedSilo() workspace: Principal.Silo,
        @Param('id') id: string,
    ): Promise<Record<string, never>> {
        await this.listingService.delete(workspace, Listing.Id.parse(id));

        return {};
    }
}
