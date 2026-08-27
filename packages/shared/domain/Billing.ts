import z from "zod"
import type { AxiosInstance } from "axios"
import { Plan } from "./Plan"
import { Workspace } from "./Workspace"

/** Paying for workspaces. What a plan then means is the workspace's own concern. */
export namespace Billing {

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
            planId: Plan.Id,
        ): Promise<Redirect> {
            const { data } = await api.post<Redirect>(`/api/billing/workspaces/${workspaceId}/plan`, { planId })

            return Redirect.parse(data)
        }

        /** Cards, invoices and cancellation, all hosted by the payment provider. */
        export async function portal(api: AxiosInstance): Promise<Redirect> {
            const { data } = await api.post<Redirect>(`/api/billing/portal`)

            return Redirect.parse(data)
        }
    }
}
