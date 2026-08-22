import { immer } from 'zustand/middleware/immer'
import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import { BaseSDK } from '@pretzel-graph/standard-ui/SDKs/Base'
import { SDK } from '@pretzel-graph/standard-ui/SDKs/SDKManager'
import { createBillingSDKActions, type _BillingSDKActions_ } from './actions'

@SDK('Billing')
export class BillingSDKImpl extends BaseSDK<BillingSDK.State> {

    constructor() { super() }

    public readonly useStore: BaseSDK.Store<BillingSDK.State> = createWithEqualityFn(
        immer<BillingSDK.State>(() => ({
            pending: null,
        })),
        shallow
    )

    public readonly actions: BillingSDK.Actions = createBillingSDKActions(this)
}

export const BillingSDK = SDK.get<BillingSDKImpl>('Billing')

export namespace BillingSDK {
    export type State = {
        /**
         * Which control is waiting on the payment provider — a plan name, or
         * `portal`. One at a time: each ends by leaving the page.
         */
        pending: string | null
    }

    export type Actions = _BillingSDKActions_
}
