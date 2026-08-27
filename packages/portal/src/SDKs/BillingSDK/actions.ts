import { Billing, type Plan, type Workspace } from '@pretzel-cloud/shared/domain'
import { NotificationSDK } from '@pretzel-graph/standard-ui/SDKs/NotificationSDK'
import { api } from '../api'
import type { BillingSDKImpl } from './sdk'

export type _BillingSDKActions_ = {
    /**
     * Puts a workspace on a plan. A first subscription leaves for a hosted
     * payment page; a change to one that already exists is settled without
     * leaving, and the new plan arrives over realtime.
     */
    changePlan: (workspaceId: Workspace.Id, planId: Plan.Id) => Promise<void>
    /** Sends the browser to manage cards, invoices and cancellation. */
    openBillingPortal: () => Promise<void>
}

export function createBillingSDKActions(sdk: BillingSDKImpl): _BillingSDKActions_ {
    const setState = sdk.useStore.setState

    /**
     * The payment pages are hosted elsewhere, so every call here ends by handing
     * the browser over. Cleared either way: leaving is not the same as having
     * left, and a visitor who comes back must not find the control still
     * waiting on a journey that already ended.
     */
    const call = async (pending: string, whenFailed: string, request: () => Promise<Billing.API.Redirect>, whenSettled?: string) => {
        setState((s) => { s.pending = pending })

        try {
            const { url } = await request()

            // No url means nothing to leave for: it was settled server side.
            if (url)
                window.location.href = url
            else if (whenSettled)
                NotificationSDK.toast.success(whenSettled)
        }
        catch {
            NotificationSDK.toast.error(whenFailed)
        }
        finally {
            setState((s) => { s.pending = null })
        }
    }

    return {
        changePlan: (workspaceId, planId) =>
            call(planId, 'Could not change the plan', () => Billing.API.changePlan(api, workspaceId, planId), 'Plan changed'),

        openBillingPortal: () =>
            call('portal', 'Could not open the billing portal', () => Billing.API.portal(api)),
    }
}
