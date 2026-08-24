import { Body, Controller, Delete, Param, Put, UseGuards } from '@nestjs/common';
import { Listing } from '@pretzel-cloud/shared/domain';
import { SiloAuthGuard } from '@/auth/guards/silo-auth.guard';
import { AuthenticatedSilo } from '@/auth/identity/principal.decorator';
import { Principal } from '@/auth/identity/principal';
import { ListingService } from './listing.service';

// The writing side of the registry: a silo sharing or withdrawing its own workflows.
@Controller('workspaces')
@UseGuards(SiloAuthGuard)
export class SiloListingController {

    constructor(private readonly listings: ListingService) {}

    @Put(':workspaceId/listings')
    public async put(
        @AuthenticatedSilo() workspace: Principal.Silo,
        @Body() body: unknown,
    ): Promise<Listing.API.Put.Response> {
        const id = await this.listings.put(workspace, Listing.API.Put.Request.parse(body));

        return { id };
    }

    @Delete(':workspaceId/listings/:id')
    public async delete(
        @AuthenticatedSilo() workspace: Principal.Silo,
        @Param('id') id: string,
    ): Promise<Record<string, never>> {
        await this.listings.delete(workspace, Listing.Id.parse(id));

        return {};
    }
}
