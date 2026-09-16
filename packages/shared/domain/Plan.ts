import z from "zod"
import type { AxiosInstance } from "axios"
import type { Machine } from "./Fleet/machine"

/**
 * What a plan is: the compute it buys, and the bounds it sets.
 *
 * A row rather than a value in the code, so a plan can be written for a single
 * customer without a deploy. Paying for one is {@link Billing}'s concern; this says
 * only what having one means.
 */
export namespace Plan {

    export const Id = z.string().min(1).brand("Plan.Id")
    export type  Id = z.infer<typeof Id>

    /** What a workspace starts on. The row decides everything after. */
    export const DEFAULT_PLAN_ID = "free" as Id

    /** What becomes of a backend nobody has used for a while. */
    export const IdleBackendPolicy = z.enum(["suspend", "stop", "none"])
    export type  IdleBackendPolicy = z.infer<typeof IdleBackendPolicy>

    export const Schema = z.object({
        id:                            Id,
        displayName:                   z.string(),
        description:                   z.string(),
        // Display only. The payment provider holds what is actually charged.
        priceCents:                    z.number().int(),
        currency:                      z.string(),
        stripePriceId:                 z.string().nullable(),
        stripeProductId:               z.string().nullable(),

        backendSize:                   z.string(),
        idleBackendPolicy:             IdleBackendPolicy,
        /** Worker machines beside the backend. None means the backend runs executions itself. */
        workerCount:                   z.number().int().min(0),
        workerSize:                    z.string().nullable(),
        /** Executions one worker runs at once. */
        workerConcurrency:             z.number().int().min(1),

        // Null is unlimited.
        maxWorkflows:                  z.number().int().nullable(),
        maxExecutionsMonthly:          z.number().int().nullable(),
        maxWorkspaceMembers:           z.number().int().nullable(),
        maxUptimeHoursMonthly:         z.number().int().nullable(),
        /** How long an execution's recorded session is kept. Null keeps it. */
        executionSessionRetentionDays: z.number().int().nullable(),

        purchasable:                   z.boolean(),
        sortOrder:                     z.number().int(),
        createdAt:                     z.coerce.date(),
        updatedAt:                     z.coerce.date(),
    })

    /** No worker machines: one machine does everything. */
    export const isCombined = (plan: Plan): boolean => plan.workerCount === 0

    /** A worker with no size of its own runs at the backend's. */
    export const getSizeForRole = (plan: Plan, role: Machine.Role): string =>
        role === "worker" ? (plan.workerSize ?? plan.backendSize) : plan.backendSize

    /** Executions the whole workspace runs at once. */
    export const getExecutionConcurrency = (plan: Plan): number =>
        Math.max(plan.workerCount, 1) * plan.workerConcurrency

    export const isPaid = (plan: Plan): boolean => plan.priceCents > 0

    export const getPriceLabel = (plan: Plan): string =>
        `${(plan.priceCents / 100).toLocaleString(undefined, { style: "currency", currency: plan.currency.toUpperCase(), maximumFractionDigits: 0 })}`

    export namespace API {

        export namespace List {
            export const Response = z.object({ plans: z.array(Schema) })
            export type  Response = z.infer<typeof Response>
        }

        /** Every plan on sale, in the order a pricing page should show them. */
        export async function list(api: AxiosInstance): Promise<List.Response> {
            const { data } = await api.get<List.Response>('/api/plans')

            return List.Response.parse(data)
        }
    }
}
export type Plan = z.infer<typeof Plan.Schema>
