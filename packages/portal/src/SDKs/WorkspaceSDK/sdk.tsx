import { immer } from 'zustand/middleware/immer'
import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import { Plan, Workspace } from '@pretzel-cloud/shared/domain'
import { RealtimeSDK } from '@/SDKs/RealtimeSDK'
import { BaseSDK } from '@pretzel-graph/standard-ui/SDKs/Base'
import { SDK } from '@pretzel-graph/standard-ui/SDKs/SDKManager'
import { createWorkspaceSDKActions, type _WorkspaceSDKActions_ } from './actions'
import { workspaceSelectors, type WorkspaceSDKSelectors } from './selectors'
import { QuerySDK } from '@pretzel-graph/standard-ui/SDKs/QuerySDK/sdk'
import { _createWorkspaceDialogs_, type _WorkspaceSDKDialogs } from './dialogs'

const WORKSPACES_STALE_TIME = 30_000

// Plans change on the order of never, so a session reads them once.
const PLANS_STALE_TIME = Infinity

@SDK('Workspace')
export class WorkspaceSDKImpl extends BaseSDK<WorkspaceSDK.State> {

    constructor() { super() }

    public readonly useStore: BaseSDK.Store<WorkspaceSDK.State> = createWithEqualityFn(
        immer<WorkspaceSDK.State>(() => ({
            workspaces: {},
            plans: {},
            transitions: {},
            rebuilding: {},
            updating: {},
            provisioning: {},
            hardwareStatistics: {},
            selectors: workspaceSelectors,
        })),
        shallow
    )

    public readonly selectors: WorkspaceSDK.Selectors = workspaceSelectors

    /** One entry per workspace the store holds, for as long as it holds it. */
    public readonly runtime = {
        unsubscribeByWorkspaceId: new Map<Workspace.Id, () => void>()
    }

    /** One descriptor, so every caller names the same cache entry. */
    private readonly workspacesQuery = {
        queryKey:  ['workspaces'] as const,
        queryFn:   () => this.actions.list(),
        staleTime: WORKSPACES_STALE_TIME,
    }

    /** Seeds the store; the subscription below keeps it live from there. */
    public useWorkspacesQuery = () => QuerySDK.useQuery<Record<Workspace.Id, Workspace>, Error>(
        this.workspacesQuery.queryKey,
        this.workspacesQuery.queryFn,
        { staleTime: this.workspacesQuery.staleTime },
    )

    /** The same query for route loaders, which run before anything renders. */
    public fetchWorkspaces = () => QuerySDK.client.fetchQuery(this.workspacesQuery)

    private readonly plansQuery = {
        queryKey:  ['plans'] as const,
        queryFn:   () => this.actions.plans.list(),
        staleTime: PLANS_STALE_TIME,
    }

    public usePlansQuery = () => QuerySDK.useQuery<Record<Plan.Id, Plan>, Error>(
        this.plansQuery.queryKey,
        this.plansQuery.queryFn,
        { staleTime: this.plansQuery.staleTime },
    )

    public fetchPlans = () => QuerySDK.client.fetchQuery(this.plansQuery)

    public readonly actions: WorkspaceSDK.Actions = createWorkspaceSDKActions(this)
    public readonly dialogs: WorkspaceSDK.Dialogs = _createWorkspaceDialogs_(this)
}

export const WorkspaceSDK = SDK.get<WorkspaceSDKImpl>('Workspace')

WorkspaceSDK.subscribe((state, prevState) => {
    if (state.workspaces === prevState.workspaces)
        return

    const { unsubscribeByWorkspaceId } = WorkspaceSDK.runtime

    const workspaceIds = new Set(Object.keys(state.workspaces) as Workspace.Id[])

    for (const [workspaceId, unsubscribe] of unsubscribeByWorkspaceId) {
        if (workspaceIds.has(workspaceId))
            continue

        unsubscribe()

        unsubscribeByWorkspaceId.delete(workspaceId)
    }

    for (const workspaceId of workspaceIds) {
        if (unsubscribeByWorkspaceId.has(workspaceId))
            continue

        unsubscribeByWorkspaceId.set(workspaceId, RealtimeSDK.subscribeToChannel<Workspace.Event.Any>(
            Workspace.Event.getChannel(workspaceId),
            (event) => WorkspaceSDK.actions.applyEvent(event),
        ))
    }
})

export namespace WorkspaceSDK {
    export type State = {
        workspaces: Record<Workspace.Id, Workspace>
        plans: Record<Plan.Id, Plan>
        transitions: Partial<Record<Workspace.Id, Workspace.Lifecycle.Action>>
        rebuilding: Partial<Record<Workspace.Id, boolean>>
        /** The release name a workspace is moving to, while it moves. */
        updating: Partial<Record<Workspace.Id, string>>
        provisioning: Partial<Record<Workspace.Id, Workspace.Provisioning.Step>>
        /** Streamed over the workspace channel while the machines are running. */
        hardwareStatistics: Partial<Record<Workspace.Id, Workspace.HardwareStatistics>>
        selectors: WorkspaceSDKSelectors
    }

    export type SortField     = 'name' | 'created'
    export type SortDirection = 'asc' | 'desc'
    export type Sort          = { field: SortField; direction: SortDirection }

    export type Selectors = WorkspaceSDKSelectors
    export type Actions = _WorkspaceSDKActions_
    export type Dialogs = _WorkspaceSDKDialogs
}
