import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { requireEnv } from '@/db/table';

/** One client, shared by what calls Stripe and what Stripe calls. */
@Injectable()
export class StripeClient {

    private instance: Stripe | undefined;

    // Built on first use, so a control plane configured without billing boots.
    public get client(): Stripe {
        return this.instance ??= new Stripe(requireEnv('STRIPE_SECRET_KEY'));
    }
}
