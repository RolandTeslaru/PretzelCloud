import { Module } from '@nestjs/common';
import { ListingModule } from '@/services/Listing/listing.module';
import { ExtendedShelfController } from './extended-shelf.controller';
import { ExtendedShelfService } from './extended-shelf.service';
import { ExtendedShelfAdminService } from './extended-shelf.admin.service';
import { ExtendedShelfRepository } from './extended-shelf.repository';

@Module({
    imports:     [ListingModule],
    controllers: [ExtendedShelfController],
    providers:   [ExtendedShelfService, ExtendedShelfAdminService, ExtendedShelfRepository],
})
export class ExtendedShelfModule { }
