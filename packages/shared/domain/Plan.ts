import z from "zod"
import { Machine } from "./Fleet/machine"

/**
 * What a plan is: the compute it buys, and the bounds it sets.
 *
 * A row rather than a value in the code, so a plan can be written for a single
 * customer without a deploy. Paying for one is [[Billing]]'s concern; this says
 * only what having one means.
 */
export namespace Plan {

    export const Id = z.string().min(1).brand("Plan.Id")
    export type  Id = z.infer<typeof Id>

    /** One machine doing everything, or a backend with its own worker beside it. */
    export const Topology = z.enum(["combined", "separate"])
    export type  Topology = z.infer<typeof Topology>

    /** What becomes of a backend nobody has used for a while. */
    export const IdleBackendPolicy = z.enum(["suspend", "stop", "none"])
    export type  IdleBackendPolicy = z.infer<typeof IdleBackendPolicy>

    export const Schema = z.object({
        id:          Id,
        displayName: z.string(),
        // Display only. The payment provider holds what is actually charged.
        priceCents:  z.number().int(),
        currency:    z.string(),
        stripePriceId:   z.string().nullable(),
        stripeProductId: z.string().nullable(),

        topology:          Topology,
        backendSize:       z.string(),
        workerSize:        z.string().nullable(),
        idleBackendPolicy: IdleBackendPolicy,
        executionConcurrencyLimit: z.number().int(),

        // Null is unlimited.
        maxWorkflows:          z.number().int().nullable(),
        maxExecutionsMonthly:  z.number().int().nullable(),
        maxWorkspaceMembers:   z.number().int().nullable(),
        maxUptimeHoursMonthly: z.number().int().nullable(),

        purchasable: z.boolean(),
        sortOrder:   z.number().int(),
        createdAt:   z.coerce.date(),
        updatedAt:   z.coerce.date(),
    })

    /** The machines this plan's compute is made of. */
    export const getRoles = (plan: Plan): Machine.Role[] =>
        plan.topology === "separate" ? ["backend", "worker"] : ["combined"]

    /** The size the machine of a given role runs at. */
    export const getSizeForRole = (plan: Plan, role: Machine.Role): string =>
        role === "worker" ? (plan.workerSize ?? plan.backendSize) : plan.backendSize

    /** Whether anything is paid for it. */
    export const isPaid = (plan: Plan): boolean => plan.priceCents > 0

    /** What a price shows as, from the amount the provider charges. */
    export const getPriceLabel = (plan: Plan): string =>
        `${(plan.priceCents / 100).toLocaleString(undefined, { style: "currency", currency: plan.currency.toUpperCase(), maximumFractionDigits: 0 })}`
}
export type Plan = z.infer<typeof Plan.Schema>
