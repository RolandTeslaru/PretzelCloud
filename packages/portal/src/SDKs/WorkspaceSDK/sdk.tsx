import { immer } from 'zustand/middleware/immer'
import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import { Plan, Workspace } from '@pretzel-cloud/shared/domain'
import { RealtimeSDK } from '@/SDKs/RealtimeSDK'
import { BaseSDK } from '@pretzel-graph/standard-ui/SDKs/Base'
import { SDK } from '@pretzel-graph/standard-ui/SDKs/SDKManager'
import { createWorkspaceSDKActions, type _WorkspaceSDKActions_ } from './actions'
import { workspaceSelectors, type WorkspaceSDKSelectors } from './selectors'
import { _createWorkspaceDialogs_, type _WorkspaceSDKDialogs } from './dialogs'

const WORKSPACES_STALE_TIME = 30_000

// Plans change on the order of never, so a session reads them once.
const PLANS_STALE_TIME = Infinity

const QUERY_OPTIONS = {
    retry: 5,
    retryDelay: (attemptIndex: number) => Math.min(1000 * 2 ** attemptIndex, 30_000),
}

@SDK('Workspace')
export class WorkspaceSDKImpl extends BaseSDK<WorkspaceSDK.State> {

    constructor() { super() }

    public readonly useStore: BaseSDK.Store<WorkspaceSDK.State> = createWithEqualityFn(
        immer<WorkspaceSDK.State>(() => ({
            workspaces: {},
            plans: {},
            transitions: {},
            rebuilding: {},
            destroying: {},
            updating: {},
            provisioning: {},
            hardwareStatistics: {},
            selectors: workspaceSelectors,
        })),
        shallow
    )

    public readonly selectors: WorkspaceSDK.Selectors = workspaceSelectors

    public override cleanup() {
        this.setState((s) => {
            s.workspaces = {}
            s.plans = {}
            s.transitions = {}
            s.rebuilding = {}
            s.destroying = {}
            s.updating = {}
            s.provisioning = {}
            s.hardwareStatistics = {}
        })
    }

    /** One entry per workspace the store holds, for as long as it holds it. */
    public readonly runtime = {
        unsubscribeByWorkspaceId: new Map<Workspace.Id, () => void>()
    }

    public readonly query = {
        workspacesList: {
            ...QUERY_OPTIONS,
            queryKey:  ['workspaces'] as const,
            queryFn:   () => this.actions.list(),
            staleTime: WORKSPACES_STALE_TIME,
        },
        plansList: {
            ...QUERY_OPTIONS,
            queryKey:  ['plans'] as const,
            queryFn:   () => this.actions.plans.list(),
            staleTime: PLANS_STALE_TIME,
        },
    }

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
        /** Held from `destroy:started` until the workspace is gone or the destroy fails. */
        destroying: Partial<Record<Workspace.Id, boolean>>
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

    /** A lifecycle state, a transition in flight, or a flag that overrides both. */
    export type DisplayStatus = Workspace.Lifecycle.State | Workspace.Lifecycle.Action | 'destroying' | 'rebuilding' | 'updating'

    export type Selectors = WorkspaceSDKSelectors
    export type Actions = _WorkspaceSDKActions_
    export type Dialogs = _WorkspaceSDKDialogs
}
