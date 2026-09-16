import { Module } from '@nestjs/common';
import { FleetModule } from '@/services/Fleet/fleet.module';
import { AdminController } from './admin.controller';

@Module({
    imports:     [FleetModule],
    controllers: [AdminController],
})
export class AdminModule { }
