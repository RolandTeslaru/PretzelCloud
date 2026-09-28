import { Module } from '@nestjs/common';
import { ListingController } from './listing.controller';
import { ListingService } from './listing.service';
import { ListingRepository } from './listing.repository';
import { ListingAdminController } from './listing.admin.controller';
import { ListingAdminService } from './listing.admin.service';
import { ListingAdminRepository } from './listing.admin.repository';

@Module({
    controllers: [ListingController, ListingAdminController],
    providers: [ListingService, ListingRepository, ListingAdminService, ListingAdminRepository],
    exports:   [ListingService, ListingRepository],
})
export class ListingModule { }
