import z from "zod"
import type { AxiosInstance } from "axios"
import { Workspace } from "./Workspace"

/** Paying for workspaces. What a plan then means is the workspace's own concern. */
export namespace Billing {

    /** What each plan costs and what it buys, for the pages that offer them. */
    export const OFFERS: { plan: Workspace.Plan; label: string; price: string; blurb: string }[] = [
        { plan: "free", label: "Free",  price: "$0",  blurb: "One machine. Sleeps when unused." },
        { plan: "base", label: "Base",  price: "$25", blurb: "Always on. Runs on its own machine." },
        { plan: "pro",  label: "Pro",   price: "$60", blurb: "Always on, with more room to run." },
    ]

    export const getOfferForPlan = (plan: Workspace.Plan) =>
        OFFERS.find((offer) => offer.plan === plan) ?? OFFERS[0]!

    export namespace API {

        /**
         * Somewhere to send the browser, or nothing when none is needed. A first
         * subscription is bought on a hosted page; changing an existing one is
         * settled server to server, with the difference prorated.
         */
        export const Redirect = z.object({ url: z.url().nullable() })
        export type  Redirect = z.infer<typeof Redirect>

        /** Puts one workspace on one plan, whether or not it already pays for one. */
        export async function changePlan(
            api: AxiosInstance,
            workspaceId: Workspace.Id,
            plan: Workspace.Plan,
        ): Promise<Redirect> {
            const { data } = await api.post<Redirect>(`/api/billing/workspaces/${workspaceId}/plan`, { plan })

            return Redirect.parse(data)
        }

        /** Cards, invoices and cancellation, all hosted by the payment provider. */
        export async function portal(api: AxiosInstance): Promise<Redirect> {
            const { data } = await api.post<Redirect>(`/api/billing/portal`)

            return Redirect.parse(data)
        }
    }
}
