import { Module } from '@nestjs/common';
import { ListingModule } from '@/services/Listing/listing.module';
import { ExtendedShelfController } from './extended-shelf.controller';
import { ExtendedShelfService } from './extended-shelf.service';
import { ExtendedShelfAdminService } from './extended-shelf.admin.service';

@Module({
    imports:     [ListingModule],
    controllers: [ExtendedShelfController],
    providers:   [ExtendedShelfService, ExtendedShelfAdminService],
})
export class ExtendedShelfModule { }
