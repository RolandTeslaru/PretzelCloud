import { z } from "zod"
import type { AxiosInstance } from "axios"
import { User } from "../User"
import { WorkspaceId, createId as createWorkspaceId } from "./ids"
import * as SubdomainMod from "./subdomain"
import { Realtime } from "../Realtime"
import { Plan } from "../Plan"
import { Fleet } from "../Fleet"

// A workspace as the portal knows it: desired state. What has been materialized
// for it lives in Fleet, on another credential.
export namespace Workspace {

    export const Id = WorkspaceId
    export type  Id = WorkspaceId
    export const createId = createWorkspaceId

    export import Subdomain = SubdomainMod.Subdomain

    export namespace Lifecycle {

        /**
         * What a workspace should be doing. Its machines follow; what they are
         * observed doing is `Fleet.Machine.State` and stays in the fleet.
         */
        export const State = z.enum([
            "creating",
            "running",
            // Parked to save money. Which rung — suspended, stopped, or given back
            // entirely — is the ladder's business; traffic brings it back either way.
            "sleeping",
            "stopped",   // The owner turned it off. Traffic does not wake it.
            "disabled",  // The fleet turned it off. The owner cannot undo it.
            "provisioning_failed",
        ])
        export type  State = z.infer<typeof State>

        /** What can be asked of a workspace. The machines follow from where it lands. */
        export const Action = z.enum(["start", "stop", "suspend", "restart"])
        export type  Action = z.infer<typeof Action>

        const LANDS_ON: Record<Action, State> = {
            start:   "running",
            stop:    "stopped",
            suspend: "sleeping",
            restart: "running",
        }

        export const getStateFromAction = (action: Action): State =>
            LANDS_ON[action]

        /** How a transition is run when something larger is doing the announcing. */
        export type TransitionOptions = { emitNoEvents?: boolean }

        /** Whether traffic arriving may bring it up. */
        export const isWakeable = (state: State): boolean =>
            state === "sleeping"

        /** Whether a request arriving may be served, after a wake if need be. */
        export const acceptsTraffic = (state: State): boolean =>
            state === "running" || state === "sleeping"
    }

    export namespace Provisioning {

        export const Step = z.enum([
            "hardware",
            "secrets",
            "machines",
            "health",
            "owner",
            "hostnames",
            "convert",
            "rebuild",
        ])
        export type  Step = z.infer<typeof Step>
    }

    export const DisplayName = z.string().trim()
        .min(1, 'Workspace name is required')
        .max(64, 'Workspace name must be at most 64 characters')

    export const Schema = z.object({
        id:                 Id,
        // Null until a paid plan sets one; the canonical host is derived.
        subdomain:          Subdomain.Schema.nullable(),
        displayName:        z.string(),
        lifecycleState:     Lifecycle.State,
        /** Why the fleet froze it, for the portal to render. Null unless disabled. */
        disabledReason:     z.string().nullable(),
        plan:               Plan.Schema,
        // What the payment provider says about the subscription behind the plan.
        // Null while nothing is paying for it.
        subscriptionStatus: z.string().nullable(),
        /** The window the provider bills over. Null while nothing pays for it. */
        currentPeriodStart: z.coerce.date().nullable(),
        currentPeriodEnd:   z.coerce.date().nullable(),
        ownerId:            User.Id,
        // Derived where the fleet domain is known; a browser cannot build it.
        appUrl:             z.url(),
        createdAt:          z.coerce.date(),
        updatedAt:          z.coerce.date(),
    })








    /**
     * What a workspace has used, as the fleet recorded it. Counted here rather
     * than in the workspace, whose database belongs to the payer.
     */
    export namespace Usage {

        export const Id = z.uuid().brand("Workspace.Usage.Id")
        export type  Id = z.infer<typeof Id>

        export const Schema = z.object({
            id:          Id,
            workspaceId: WorkspaceId,
            /** In the workspace's own database. Null when its answer was unreadable. */
            executionId: z.uuid().nullable(),
            /** As the workspace reported it; unparsed by the fleet. */
            igniter:     z.string().nullable(),
            createdAt:   z.coerce.date(),
        })

        export const Period = z.object({
            start: z.coerce.date(),
            /** Null while it is the one running now. */
            end:   z.coerce.date().nullable(),
        })
        export type Period = z.infer<typeof Period>

        export const Allowance = z.object({
            limit:       z.number().int().nullable(),
            periodStart: z.coerce.date().nullable(),
            periodEnd:   z.coerce.date().nullable(),
        })
        export type Allowance = z.infer<typeof Allowance>

        /** What one execution costs against a plan. One, always — for now. */
        export const COST = 1

        /** The calendar month, for a workspace with no subscription to bill from. */
        const getCalendarMonth = (at: Date): Period => ({
            start: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)),
            end:   null,
        })

        /**
         * The period usage is counted over right now. A subscription bills from its
         * anniversary; a stored period that has lapsed restarts at its own end,
         * since the renewal is known before the provider's event arrives.
         */
        export const getCurrentPeriod = (
            periodStart: Date | null,
            periodEnd:   Date | null,
            at:          Date = new Date(),
        ): Period => {
            if (!periodStart)
                return getCalendarMonth(at)

            if (periodEnd && at >= periodEnd)
                return { start: periodEnd, end: null }

            return { start: periodStart, end: periodEnd }
        }

        /** Whether another execution fits. A null limit is unlimited. */
        export const isWithinLimit = (used: number, limit: number | null): boolean =>
            limit === null || used + COST <= limit

        export const getRemaining = (used: number, limit: number | null): number | null =>
            limit === null ? null : Math.max(0, limit - used)

        export const Window = z.enum(["today", "week", "month"])
        export type  Window = z.infer<typeof Window>

        const DAY_MS = 24 * 60 * 60 * 1000

        /**
         * What a window covers, ending now. `today` is the calendar day in UTC;
         * the other two roll back 7 and 30 days from this moment.
         */
        export const getPeriodFromWindow = (window: Window, at: Date = new Date()): Period => {
            if (window === "today")
                return { start: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())), end: null }

            const days = window === "week" ? 7 : 30

            return { start: new Date(at.getTime() - days * DAY_MS), end: null }
        }

        export const Point = z.object({
            day:   z.coerce.date(),
            count: z.number().int(),
        })
        export type Point = z.infer<typeof Point>

        /** Every day in a period up to now, so days with nothing still get a slot. */
        export const getDailySeries = (period: Period, points: Point[], at: Date = new Date()): Point[] => {
            const counts = new Map(points.map((p) => [p.day.toISOString().slice(0, 10), p.count]))
            const last   = period.end && period.end < at ? period.end : at
            const series: Point[] = []

            const day = new Date(Date.UTC(period.start.getUTCFullYear(), period.start.getUTCMonth(), period.start.getUTCDate()))

            while (day <= last) {
                series.push({ day: new Date(day), count: counts.get(day.toISOString().slice(0, 10)) ?? 0 })

                day.setUTCDate(day.getUTCDate() + 1)
            }

            return series
        }

        export const Report = z.object({
            period:    Period,
            used:      z.number().int(),
            /** Null is unlimited. */
            limit:     z.number().int().nullable(),
            /** `limit - used`, floored at zero. Null when nothing bounds it. */
            remaining: z.number().int().nullable(),
        })
        export type Report = z.infer<typeof Report>
    }
    export type Usage = z.infer<typeof Usage.Schema>





    export namespace HardwareStatistics {
        export const Schema = z.object({
            machines:          z.record(Fleet.Machine.Id, Fleet.Machine.Statistics.Schema),
            /** The workspace database's size on its cluster. Null when it could not be asked. */
            databaseSizeBytes: z.number().nullable(),
            capturedAt:        z.coerce.date(),
        })
    }
    export type HardwareStatistics = z.infer<typeof HardwareStatistics.Schema>


    export namespace Event {

        export const Channel = Realtime.Channel.brand("Workspace.Event.Channel")
        export type  Channel = z.infer<typeof Channel>

        export const getChannel = (workspaceId: Id) =>
            `workspace:${workspaceId}` as Channel

        /** The id back out of a channel a client asked for, or null. */
        export const parseChannel = (channel: string): Id | null => {
            const [prefix, rest] = channel.split(':')

            if (prefix !== 'workspace')
                return null

            const parsed = Id.safeParse(rest)

            return parsed.success ? parsed.data : null
        }

        export const Base = Realtime.Event.Base.extend({
            channel:     Channel,
            workspaceId: Id,
        })

        export const LifecycleChanged = Base.extend({
            type:           z.literal('lifecycle:changed'),
            lifecycleState: Lifecycle.State,
        })

        export const PlanChanged = Base.extend({
            type: z.literal('plan:changed'),
            plan: Plan.Schema,
        })

        export const Destroyed = Base.extend({ type: z.literal('destroyed') })

        export namespace Rebuild {

            export const Started = Base.extend({ type: z.literal('rebuild:started') })

            export const Succeeded = Base.extend({ type: z.literal('rebuild:succeeded') })

            export const Failed = Base.extend({
                type:   z.literal('rebuild:failed'),
                reason: z.string(),
            })

            export type  Started = z.infer<typeof Started>
            export type  Succeeded = z.infer<typeof Succeeded>
            export type  Failed = z.infer<typeof Failed>
        }

        export namespace Transition {

            export const Started = Base.extend({
                type:   z.literal('transition:started'),
                action: Lifecycle.Action,
            })

            export const Failed = Base.extend({
                type:   z.literal('transition:failed'),
                action: Lifecycle.Action,
                reason: z.string(),
            })

            export type  Started = z.infer<typeof Started>
            export type  Failed = z.infer<typeof Failed>
        }

        export namespace Provisioning {

            export const Step = Base.extend({
                type: z.literal('provisioning:step'),
                step: Workspace.Provisioning.Step
            })
            
            export const StepFailed = Base.extend({
                type: z.literal('provisioning:step:failed'),
                step: Workspace.Provisioning.Step    
            })
        }



        export const HardwareStatistics = Base.extend({
            type:       z.literal('hardware:statistics'),
            statistics: Workspace.HardwareStatistics.Schema,
        })

        export type  Base = z.infer<typeof Base>
        export type  LifecycleChanged = z.infer<typeof LifecycleChanged>
        export type  PlanChanged = z.infer<typeof PlanChanged>
        export type  Destroyed = z.infer<typeof Destroyed>
        export type  HardwareStatistics = z.infer<typeof HardwareStatistics>

        
        export const Schema = z.discriminatedUnion('type', [
            LifecycleChanged,
            PlanChanged,
            Destroyed,
            HardwareStatistics,
            Provisioning.Step,
            Provisioning.StepFailed,
            Rebuild.Started,
            Rebuild.Succeeded,
            Rebuild.Failed,
            Transition.Started,
            Transition.Failed,
        ])

        export type Any = z.infer<typeof Schema>

        /** Derived from the workspace by whatever publishes the event. */
        const Stamped = ['channel', 'workspaceId'] as const

        /** An event as constructed, before its addressing is filled in. */
        export type Unstamped<T extends Any = Any> = Realtime.Event.Unstamped<T, typeof Stamped[number]>

        export const create = Realtime.Event.defineFactory(Schema, Stamped)
    }
    export type Event = z.infer<typeof Event.Schema>

    // Inline rather than a sibling file: a module importing back into this one
    // would be a cycle that leaves the zod schemas undefined at load.
    export namespace API {

        export namespace List {
            export const Response = z.object({
                workspaces: z.array(Schema),
                /** Only when asked for, and only workspaces a fresh reading exists for. */
                hardwareStatistics: z.record(Id, HardwareStatistics.Schema).optional(),
            })
            export type  Response = z.infer<typeof Response>
        }

        export async function list(api: AxiosInstance, options?: { getHardwareStatistics?: boolean }): Promise<List.Response> {
            const { data } = await api.get<List.Response>('/api/workspaces', {
                params: options?.getHardwareStatistics ? { getHardwareStatistics: 'true' } : undefined,
            })
            return List.Response.parse(data)
        }

        export namespace Create {
            export const Request = z.object({ displayName: DisplayName })
            export type  Request = z.infer<typeof Request>

            export const Response = z.object({ workspace: Schema })
            export type  Response = z.infer<typeof Response>
        }

        // Blocks until the workspace is provisioned, or the row is torn down.
        export async function create(api: AxiosInstance, req: Create.Request): Promise<Create.Response> {
            const { data } = await api.post<Create.Response>('/api/workspaces', req)
            return Create.Response.parse(data)
        }

        export namespace Get {
            export const Response = z.object({ workspace: Schema })
            export type  Response = z.infer<typeof Response>
        }

        export async function get(api: AxiosInstance, workspaceId: Id): Promise<Get.Response> {
            const { data } = await api.get<Get.Response>(`/api/workspaces/${workspaceId}`)
            return Get.Response.parse(data)
        }

        export namespace Rename {
            export const Request = z.object({ displayName: DisplayName })
            export type  Request = z.infer<typeof Request>

            export const Response = z.object({})
            export type  Response = z.infer<typeof Response>
        }

        export async function rename(api: AxiosInstance, workspaceId: Id, req: Rename.Request): Promise<Rename.Response> {
            const { data } = await api.patch<Rename.Response>(`/api/workspaces/${workspaceId}`, req)
            return Rename.Response.parse(data)
        }

        // Null clears it. Paid plans only; the canonical host is unaffected.
        export namespace SetSubdomain {
            export const Request = z.object({ subdomain: Subdomain.Custom.nullable() })
            export type  Request = z.infer<typeof Request>

            export const Response = z.object({})
            export type  Response = z.infer<typeof Response>
        }

        export async function setSubdomain(api: AxiosInstance, workspaceId: Id, req: SetSubdomain.Request): Promise<SetSubdomain.Response> {
            const { data } = await api.patch<SetSubdomain.Response>(`/api/workspaces/${workspaceId}/subdomain`, req)
            return SetSubdomain.Response.parse(data)
        }

        export namespace SetPlan {
            export const Request = z.object({ planId: Plan.Id })
            export type  Request = z.infer<typeof Request>
            export const Response = z.object({})
            export type  Response = z.infer<typeof Response>
        }

        export async function setPlan(api: AxiosInstance, workspaceId: Id, req: SetPlan.Request): Promise<SetPlan.Response> {
            const { data } = await api.patch<SetPlan.Response>(`/api/workspaces/${workspaceId}/plan`, req)
            return SetPlan.Response.parse(data)
        }

        // One route per action: the verb is the request, nothing dispatches on it.
        export namespace Lifecycle {
            export const Response = z.object({})
            export type  Response = z.infer<typeof Response>
        }

        const act = async (api: AxiosInstance, workspaceId: Id, action: string): Promise<Lifecycle.Response> => {
            const { data } = await api.post<Lifecycle.Response>(`/api/workspaces/${workspaceId}/${action}`)
            return Lifecycle.Response.parse(data)
        }

        export const start   = (api: AxiosInstance, workspaceId: Id) => act(api, workspaceId, 'start')
        export const stop    = (api: AxiosInstance, workspaceId: Id) => act(api, workspaceId, 'stop')
        export const suspend = (api: AxiosInstance, workspaceId: Id) => act(api, workspaceId, 'suspend')
        export const restart = (api: AxiosInstance, workspaceId: Id) => act(api, workspaceId, 'restart')
        /** Replaces the machines from the current spec; the data is untouched. */
        export const rebuild = (api: AxiosInstance, workspaceId: Id) => act(api, workspaceId, 'rebuild')

        export namespace Destroy {
            export const Response = z.object({})
            export type  Response = z.infer<typeof Response>
        }

        export async function destroy(api: AxiosInstance, workspaceId: Id): Promise<Destroy.Response> {
            const { data } = await api.delete<Destroy.Response>(`/api/workspaces/${workspaceId}`)
            return Destroy.Response.parse(data)
        }

        export namespace GetUsageReport {
            export const Response = Usage.Report
            export type  Response = z.infer<typeof Response>
        }

        export async function getUsageReport(api: AxiosInstance, workspaceId: Id): Promise<GetUsageReport.Response> {
            const { data } = await api.get<GetUsageReport.Response>(`/api/entitlements/workspaces/${workspaceId}/executions/report`)
            return GetUsageReport.Response.parse(data)
        }

        /** Executions per day over the billing period, days with none included. */
        export namespace GetUsageSeries {
            export const Response = z.object({ points: z.array(Usage.Point) })
            export type  Response = z.infer<typeof Response>
        }

        export async function getUsageSeries(api: AxiosInstance, workspaceId: Id): Promise<GetUsageSeries.Response> {
            const { data } = await api.get<GetUsageSeries.Response>(`/api/entitlements/workspaces/${workspaceId}/executions/series`)
            return GetUsageSeries.Response.parse(data)
        }

        /** The executions themselves, newest first, over a chosen window. */
        export namespace ListUsage {
            export const Response = z.object({ records: z.array(Usage.Schema) })
            export type  Response = z.infer<typeof Response>
        }

        export async function listUsage(api: AxiosInstance, workspaceId: Id, window: Usage.Window): Promise<ListUsage.Response> {
            const { data } = await api.get<ListUsage.Response>(`/api/entitlements/workspaces/${workspaceId}/executions`, { params: { window } })
            return ListUsage.Response.parse(data)
        }
    }
}
export type Workspace = z.infer<typeof Workspace.Schema>

