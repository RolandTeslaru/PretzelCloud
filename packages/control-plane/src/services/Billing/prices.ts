import Stripe from 'stripe';
import { Workspace } from '@pretzel-cloud/shared/domain';
import { requireEnv } from '@/db/table';

type Sold = Exclude<Workspace.Plan, 'free'>;

/** Which price sells which plan. Free is not sold. */
const PRICE_ENV: Record<Sold, string> = {
    base: 'STRIPE_PRICE_BASE',
    pro:  'STRIPE_PRICE_PRO',
};

export const getPriceForPlan = (plan: Sold): string => requireEnv(PRICE_ENV[plan]);

/** The plan a subscription's price sells, or null if it sells none of ours. */
export function getPlanForSubscription(subscription: Stripe.Subscription): Sold | null {
    const priceId = subscription.items.data[0]?.price.id;

    if (!priceId)
        return null;

    for (const plan of Object.keys(PRICE_ENV) as Sold[])
        if (process.env[PRICE_ENV[plan]] === priceId)
            return plan;

    return null;
}
