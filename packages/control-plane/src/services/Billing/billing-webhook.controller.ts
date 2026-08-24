import { BadRequestException, Controller, Headers, Post, RawBodyRequest, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Logger } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { BillingService } from './billing.service';

/**
 * What Stripe tells the fleet.
 *
 * Its own controller because the caller is not a person: the session and
 * membership guards the user-facing one applies would reject it. Its signature
 * is the credential.
 */
// Stripe retries on failure; a 429 would look like one.
@SkipThrottle()
@Controller('billing')
export class BillingWebhookController {

    private readonly logger = new Logger(BillingWebhookController.name);

    constructor(private readonly billing: BillingService) {}

    @Post('webhook')
    async receive(
        @Req() req: RawBodyRequest<Request>,
        @Headers('stripe-signature') signature: string | undefined,
    ): Promise<Record<string, never>> {
        if (!req.rawBody || !signature)
            throw new BadRequestException('Unsigned payload');

        const event = this.billing.constructEvent(req.rawBody, signature);

        // Awaited, not detached: a failure has to reach Stripe as a non-2xx so
        // it retries. The event id makes that retry harmless.
        await this.billing.apply(event);

        return {};
    }
}
