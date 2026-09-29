import { Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Waitlist } from '@pretzel-cloud/shared/domain';
import { ZodBody } from '@pretzel-cloud/shared/server/pipes/zod.pipe';
import { WaitlistService } from './waitlist.service';

// Open to anyone: the landing page posts here without an account.
@Controller()
export class WaitlistController {

    constructor(private readonly waitlistService: WaitlistService) {}


    // The same answer whether or not the address was already on the list.
    @Post('waitlist')
    @HttpCode(204)
    @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
    public async join(@ZodBody(Waitlist.API.Join.Request) body: Waitlist.API.Join.Request): Promise<void> {
        await this.waitlistService.join(body.email);
    }
}
