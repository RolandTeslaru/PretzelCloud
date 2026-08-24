import { Module } from '@nestjs/common';
import { ListingController } from './listing.controller';
import { ListingService } from './listing.service';
import { ListingDatabase } from './listing.database';

@Module({
    controllers: [ListingController],
    providers: [ListingService, ListingDatabase],
    exports:   [ListingService, ListingDatabase],
})
export class ListingModule { }
