import { Controller, Get, Param, Query } from '@nestjs/common';
import { Listing } from '@pretzel-cloud/shared/domain';
import { ListingService } from './listing.service';

// The open side of the registry: no session, no token.
@Controller('listings')
export class ListingController {

    constructor(private readonly listings: ListingService) {}


    // Before :id, or the literal would be parsed as one.
    @Get('updates')
    public async updates(@Query() query: unknown): Promise<Listing.API.Updates.Response> {
        const { ids } = Listing.API.Updates.Request.parse(query);

        return { updates: await this.listings.getUpdates(ids) };
    }

    @Get(':id')
    public async get(@Param('id') id: string): Promise<Listing.API.Get.Response> {
        return { workflow: await this.listings.get(Listing.Id.parse(id)) };
    }
}
