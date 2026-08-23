import { immer } from 'zustand/middleware/immer'
import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import type { Fleet, Workspace } from '@pretzel-cloud/shared/domain'
import { BaseSDK } from '@pretzel-graph/standard-ui/SDKs/Base'
import { SDK } from '@pretzel-graph/standard-ui/SDKs/SDKManager'
import { createWorkspaceSDKActions, type _WorkspaceSDKActions_ } from './actions'
import { workspaceSelectors, type WorkspaceSDKSelectors } from './selectors'
import { DialogSDK } from '@pretzel-graph/standard-ui/SDKs/DialogSDK'
import WorkspaceConfiguration, { type ItemId } from './ui/WorkspaceConfiguration'
import { DestroyWorkspaceDialog } from './ui/WorkspaceConfiguration/DestroyWorkspaceDialog'
import { NotificationSDK } from '@pretzel-graph/standard-ui/SDKs/NotificationSDK'

// Per workspace, so opening one from another card does not reuse its panel state.
const configurationDialogId = (workspaceId: Workspace.Id) => `workspace-configuration-${workspaceId}`

const destroyDialogId = (workspaceId: Workspace.Id) => `destroy-workspace-${workspaceId}`

@SDK('Workspace')
export class WorkspaceSDKImpl extends BaseSDK<WorkspaceSDK.State> {

    constructor() { super() }

    public readonly useStore: BaseSDK.Store<WorkspaceSDK.State> = createWithEqualityFn(
        immer<WorkspaceSDK.State>(() => ({
            workspaces: {},
            transitions: {},
            selectors: workspaceSelectors,
        })),
        shallow
    )

    public readonly selectors: WorkspaceSDK.Selectors = workspaceSelectors

    /** `currentPanel` opens straight onto one, for callers that already know which. */
    public openConfigurationDialog = (workspaceId: Workspace.Id, currentPanel?: ItemId) => {
        const id = configurationDialogId(workspaceId)

        DialogSDK.actions.push(id, (props) => (
            <DialogSDK.UnstyledTemplate {...props}>
                <WorkspaceConfiguration
                    workspaceId={workspaceId}
                    dialogId={id}
                    currentPanel={currentPanel}
                    surfaceStyle={props.surfaceStyle}
                    blockTransparency={props.blockTransparency}
                />
            </DialogSDK.UnstyledTemplate>
        ))
    }

    /** Asks for the workspace by name first. Takes its settings dialog down with it. */
    public openDestroyDialog = (workspaceId: Workspace.Id) => {
        const workspace = this.state.workspaces[workspaceId]

        if (!workspace)
            return

        const id = destroyDialogId(workspaceId)

        DialogSDK.actions.push(id, (props) => (
            <DestroyWorkspaceDialog
                {...props}
                displayName={workspace.displayName}
                onCancel={() => DialogSDK.actions.pop(id)}
                onApprove={async () => {
                    DialogSDK.actions.pop(id)

                    try {
                        await this.actions.destroy(workspaceId)

                        NotificationSDK.toast.success(`${workspace.displayName} destroyed`)

                        // The settings it configured no longer exist.
                        DialogSDK.actions.pop(configurationDialogId(workspaceId))
                    }
                    catch {
                        NotificationSDK.toast.error('Could not destroy the workspace')
                    }
                }}
            />
        ))
    }

    public readonly actions: WorkspaceSDK.Actions = createWorkspaceSDKActions(this)
}

export const WorkspaceSDK = SDK.get<WorkspaceSDKImpl>('Workspace')

export namespace WorkspaceSDK {
    export type State = {
        // Keyed by id so a single workspace can be updated without walking a
        // list; ordering is a selector's job.
        workspaces: Record<Workspace.Id, Workspace>
        // What each workspace is in the middle of, for as long as it is. Beside
        // the workspaces rather than inside them: the machine is not in this
        // state, nothing stores it, and the next reading of the row would drop
        // it anyway.
        transitions: Partial<Record<Workspace.Id, Fleet.Machine.LifecycleAction>>
        selectors: WorkspaceSDKSelectors
    }

    export type SortField     = 'name' | 'created'
    export type SortDirection = 'asc' | 'desc'
    export type Sort          = { field: SortField; direction: SortDirection }

    export type Selectors = WorkspaceSDKSelectors
    export type Actions = _WorkspaceSDKActions_
}
