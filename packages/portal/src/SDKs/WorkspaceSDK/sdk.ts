import { immer } from 'zustand/middleware/immer'
import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import type { Workspace } from '@pretzel-cloud/shared/domain'
import { BaseSDK } from '@pretzel-graph/standard-ui/SDKs/Base'
import { SDK } from '@pretzel-graph/standard-ui/SDKs/SDKManager'
import { createWorkspaceSDKActions, type _WorkspaceSDKActions_ } from './actions'
import { workspaceSelectors, type WorkspaceSDKSelectors } from './selectors'

@SDK('Workspace')
export class WorkspaceSDKImpl extends BaseSDK<WorkspaceSDK.State> {

    constructor() { super() }

    public readonly useStore: BaseSDK.Store<WorkspaceSDK.State> = createWithEqualityFn(
        immer<WorkspaceSDK.State>(() => ({
            workspaces: {},
            selectors: workspaceSelectors,
        })),
        shallow
    )

    public readonly selectors: WorkspaceSDK.Selectors = workspaceSelectors

    public readonly actions: WorkspaceSDK.Actions = createWorkspaceSDKActions(this)
}

export const WorkspaceSDK = SDK.get<WorkspaceSDKImpl>('Workspace')

export namespace WorkspaceSDK {
    export type State = {
        // Keyed by id so a single workspace can be updated without walking a
        // list; ordering is a selector's job.
        workspaces: Record<Workspace.Id, Workspace>
        selectors: WorkspaceSDKSelectors
    }

    export type SortField     = 'name' | 'created'
    export type SortDirection = 'asc' | 'desc'
    export type Sort          = { field: SortField; direction: SortDirection }

    export type Selectors = WorkspaceSDKSelectors
    export type Actions = _WorkspaceSDKActions_
}
