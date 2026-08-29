import { immer } from 'zustand/middleware/immer'
import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import { Plan, Workspace } from '@pretzel-cloud/shared/domain'
import { RealtimeSDK } from '@/SDKs/RealtimeSDK'
import { BaseSDK } from '@pretzel-graph/standard-ui/SDKs/Base'
import { SDK } from '@pretzel-graph/standard-ui/SDKs/SDKManager'
import { createWorkspaceSDKActions, type _WorkspaceSDKActions_ } from './actions'
import { workspaceSelectors, type WorkspaceSDKSelectors } from './selectors'
import { DialogSDK } from '@pretzel-graph/standard-ui/SDKs/DialogSDK'
import { Dialog } from '@pretzel-graph/standard-ui/foundations'
import { ServerIllustration } from '@pretzel-graph/standard-ui/icons/illustrations'
import WorkspaceConfiguration, { type ItemId } from './ui/WorkspaceConfiguration'
import { CreateWorkspaceDialog } from './ui/CreateWorkspaceDialog'
import { DestroyWorkspaceDialog } from './ui/WorkspaceConfiguration/DestroyWorkspaceDialog'
import { NotificationSDK } from '@pretzel-graph/standard-ui/SDKs/NotificationSDK'
import { QuerySDK } from '@pretzel-graph/standard-ui/SDKs/QuerySDK/sdk'

// Per workspace, so opening one from another card does not reuse its panel state.
const configurationDialogId = (workspaceId: Workspace.Id) => `workspace-configuration-${workspaceId}`

const destroyDialogId = (workspaceId: Workspace.Id) => `destroy-workspace-${workspaceId}`

// One at a time, unlike the others: it is not opened from a workspace.
const CREATE_DIALOG_ID = 'create-workspace'

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

    public openCreateWorkspaceDialog = () => {
        DialogSDK.actions.push(CREATE_DIALOG_ID, (props) => (
            <DialogSDK.SplitTemplate
                {...props}
                className='h-[400px]'
                sidebarClassName='w-[400px]'
                sidebarRenderer={() => (
                    <>
                        <div className='flex flex-row gap-2'>
                            <ServerIllustration className='size-10 shrink-0' />
                            <Dialog.Title className='text-sm font-semibold my-auto'>Workspace Builder</Dialog.Title>
                        </div>
                        <Dialog.Description className='text-xs text-muted-foreground pt-1'>
                            Every workspace is its own isolated deployment with a private database and private compute.
                        </Dialog.Description>
                    </>
                )}
            >
                <CreateWorkspaceDialog dialogId={CREATE_DIALOG_ID} />
            </DialogSDK.SplitTemplate>
        ))
    }

    /** `currentPanel` opens straight onto one, for callers that already know which. */
    public openConfigurationDialog = (workspaceId: Workspace.Id, currentPanel?: ItemId) => {
        const id = configurationDialogId(workspaceId)

        DialogSDK.actions.push(id, (props) => (
            <WorkspaceConfiguration
                {...props}
                workspaceId={workspaceId}
                dialogId={id}
                currentPanel={currentPanel}
            />
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
}
