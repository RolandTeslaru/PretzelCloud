import { Module } from '@nestjs/common';
import { ListingController } from './listing.controller';
import { SiloListingController } from './silo-listing.controller';
import { ListingService } from './listing.service';
import { ListingDatabase } from './listing.database';

@Module({
    controllers: [ListingController, SiloListingController],
    providers: [ListingService, ListingDatabase],
    exports:   [ListingService],
})
export class ListingModule { }
