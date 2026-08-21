import { z } from "zod"
import type { AxiosInstance } from "axios"
import { User } from "../User"
import { Cluster } from "../Fleet/cluster"
import { Machine as MachineMod } from "../Fleet/machine"
import { WorkspaceId, createId as createWorkspaceId } from "./ids"
import * as SubdomainMod from "./subdomain"
import { Realtime } from "../Realtime"

// A workspace as the portal knows it: desired state. What has been materialized
// for it lives in Fleet, on another credential.
export namespace Workspace {

    export const Id = WorkspaceId
    export type  Id = WorkspaceId
    export const createId = createWorkspaceId

    export import Subdomain = SubdomainMod.Subdomain

    // 'failed' is not a state the user sees. A workspace that cannot be
    // provisioned is torn down and its row deleted, so they simply retry; the
    // row survives only when teardown itself failed and the reconciler still
    // has work to do.
    export const ProvisioningStatus = z.enum(["provisioning", "ready", "suspended", "failed"])
    export type  ProvisioningStatus = z.infer<typeof ProvisioningStatus>

    export const Plan = z.enum(["free", "starter", "pro"])
    export type  Plan = z.infer<typeof Plan>

    /** Everything above free. Paid plans split their compute and may set a subdomain. */
    export const isPaid = (plan: Plan): boolean => plan !== "free"

    /**
     * The machines a plan's compute is made of.
     *
     * Free runs one machine: it has a booting screen by design, so an
     * always-warm backend buys it nothing and one machine halves the dormant
     * floor. Paid splits, so the worker's memory sits on a usage clock instead
     * of being paid for around the clock.
     */
    export const getTopology = (plan: Plan): MachineMod.Role[] =>
        isPaid(plan) ? ["backend", "worker"] : ["combined"]


    export const DisplayName = z.string().trim()
        .min(1, 'Workspace name is required')
        .max(64, 'Workspace name must be at most 64 characters')

    // What this workspace's database and role are called in the cluster. Derived
    // from the id rather than stored, so nothing can drift and a workspace whose
    // row is lost is still locatable. Underscores because a uuid's dashes are not
    // legal in an unquoted identifier.
    const identifier = (id: Id) => id.replace(/-/g, '')

    export const getDatabaseName = (id: Id) =>
        Cluster.Database.Name.parse(`wspace_${identifier(id)}`)

    export const getRoleName = (id: Id) =>
        Cluster.Role.Name.parse(`wspace_role_${identifier(id)}`)

    export const Schema = z.object({
        id:          Id,
        // Null until a paid plan sets one; the canonical host is derived.
        subdomain:   Subdomain.Schema.nullable(),
        displayName: z.string(),
        provisioningStatus: ProvisioningStatus,
        // The workspace's machine state — null while it has no machine yet.
        state:       MachineMod.State.nullable(),
        plan:        Plan,
        ownerId:     User.Id,
        // Derived rather than stored, and assembled where the fleet domain is
        // known — a browser has no way to build it.
        appUrl:      z.url(),
        createdAt:   z.coerce.date(),
        updatedAt:   z.coerce.date(),
    })

    // One channel per workspace: workspace:<id>. Outbound only — every command
    // travels over the API below.
    //
    // Inline for the same reason API is: these reference ProvisioningStatus
    // above, and a separate module importing back into this one would be a
    // cycle that leaves the zod schemas undefined at load.
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
        export type  Base = z.infer<typeof Base>

        export const StateChanged = Base.extend({
            type:  z.literal('state:changed'),
            state: MachineMod.State.nullable(),
        })
        export type  StateChanged = z.infer<typeof StateChanged>

        export const ProvisioningChanged = Base.extend({
            type:               z.literal('provisioning:changed'),
            provisioningStatus: ProvisioningStatus,
        })
        export type  ProvisioningChanged = z.infer<typeof ProvisioningChanged>

        export const Destroyed = Base.extend({ type: z.literal('destroyed') })
        export type  Destroyed = z.infer<typeof Destroyed>

        /**
         * A transition in flight. Not a machine state and never stored — the
         * machine holds whatever it last settled on until this one finishes,
         * and `state:changed` says what that turned out to be.
         *
         * The action rather than a state per action: the actions are already an
         * enum, and what to call each one while it runs is the reader's choice.
         */
        export const TransitionStarted = Base.extend({
            type:   z.literal('transition:started'),
            action: MachineMod.LifecycleAction,
        })
        export type  TransitionStarted = z.infer<typeof TransitionStarted>

        export const Schema = z.discriminatedUnion('type', [StateChanged, ProvisioningChanged, Destroyed, TransitionStarted])

        export type Any = z.infer<typeof Schema>

        /** Derived from the workspace by whatever publishes the event. */
        const Stamped = ['channel', 'workspaceId'] as const

        /** An event as constructed, before its addressing is filled in. */
        export type Unstamped<T extends Any = Any> = Realtime.Event.Unstamped<T, typeof Stamped[number]>

        export const create = Realtime.Event.defineFactory(Schema, Stamped)
    }

    // Inline rather than a sibling file: these reference Schema and Subdomain
    // above, and a separate module importing back into this one would be a
    // cycle that leaves the zod schemas undefined at load.
    export namespace API {

        export namespace List {
            export const Response = z.object({ workspaces: z.array(Schema) })
            export type  Response = z.infer<typeof Response>
        }

        export async function list(api: AxiosInstance): Promise<List.Response> {
            const { data } = await api.get<List.Response>('/api/workspaces')
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
            export const Request = z.object({ plan: Plan })
            export type  Request = z.infer<typeof Request>
            export const Response = z.object({})
            export type  Response = z.infer<typeof Response>
        }

        export async function setPlan(api: AxiosInstance, workspaceId: Id, req: SetPlan.Request): Promise<SetPlan.Response> {
            const { data } = await api.patch<SetPlan.Response>(`/api/workspaces/${workspaceId}/plan`, req)
            return SetPlan.Response.parse(data)
        }

        // One route per action rather than an action in a body: the verb is the
        // request, and nothing has to be dispatched on the way down.
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
        export const resume  = (api: AxiosInstance, workspaceId: Id) => act(api, workspaceId, 'resume')
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

    }
}
export type Workspace = z.infer<typeof Workspace.Schema>

