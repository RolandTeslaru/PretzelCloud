import { Module } from '@nestjs/common';
import { WaitlistController } from './waitlist.controller';
import { WaitlistService } from './waitlist.service';
import { WaitlistRepository } from './waitlist.repository';

@Module({
    controllers: [WaitlistController],
    providers:   [WaitlistService, WaitlistRepository],
})
export class WaitlistModule { }
