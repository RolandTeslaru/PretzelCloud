import { Workspace } from '@pretzel-cloud/shared/domain'
import { DialogSDK } from '@pretzel-graph/standard-ui/SDKs/DialogSDK'
import { Dialog } from '@pretzel-graph/standard-ui/foundations'
import { ServerIllustration } from '@pretzel-graph/standard-ui/icons/illustrations'
import { NotificationSDK } from '@pretzel-graph/standard-ui/SDKs/NotificationSDK'
import WorkspaceConfiguration, { type ItemId } from './ui/WorkspaceConfiguration'
import { CreateWorkspaceDialog } from './ui/CreateWorkspaceDialog'
import { UpdateWorkspaceDialog } from './ui/UpdateWorkspaceDialog'
import { DestroyWorkspaceDialog } from './ui/WorkspaceConfiguration/DestroyWorkspaceDialog'
import type { WorkspaceSDKImpl } from './sdk'

// Per workspace, so opening one from another card does not reuse its panel state.
const configurationDialogId = (workspaceId: Workspace.Id) => `workspace-configuration-${workspaceId}`

const destroyDialogId = (workspaceId: Workspace.Id) => `destroy-workspace-${workspaceId}`

const updateDialogId = (workspaceId: Workspace.Id) => `update-workspace-${workspaceId}`

// One at a time: it is not opened from a workspace.
const CREATE_DIALOG_ID = 'create-workspace'

export const openCreateWorkspaceDialog = () => {
    DialogSDK.actions.push(CREATE_DIALOG_ID, (props) => (
        <DialogSDK.SplitTemplate
            {...props}
            className='h-[400px]'
            sidebarClassName='w-[300px]'
            contentClassName='w-[400px]'
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

export const openUpdateDialog = (workspaceId: Workspace.Id) => {
    const id = updateDialogId(workspaceId)

    DialogSDK.actions.push(id, (props) => (
        <DialogSDK.SplitTemplate
            {...props}
            className='h-[400px]'
            sidebarClassName='w-[250px]'
            contentClassName='w-[400px]'
            sidebarRenderer={() => (
                <>
                    <div className='flex flex-row gap-2'>
                        <ServerIllustration className='size-10 shrink-0' />
                        <Dialog.Title className='text-sm font-semibold my-auto'>Workspace Update</Dialog.Title>
                    </div>
                    <Dialog.Description className='text-xs text-muted-foreground pt-1'>
                        Rebuilds the workspace from a newer PretzelGraph release.
                    </Dialog.Description>
                </>
            )}
        >
            <UpdateWorkspaceDialog dialogId={id} workspaceId={workspaceId} />
        </DialogSDK.SplitTemplate>
    ))
}

// `currentPanel` opens straight onto one panel.
export const openConfigurationDialog = (workspaceId: Workspace.Id, currentPanel?: ItemId) => {
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

// Confirms by name, then closes the workspace's settings dialog too.
export const openDestroyDialog = (sdk: WorkspaceSDKImpl, workspaceId: Workspace.Id) => {
    const workspace = sdk.state.workspaces[workspaceId]

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
                    await sdk.actions.destroy(workspaceId)

                    NotificationSDK.toast.success(`${workspace.displayName} destroyed`)

                    DialogSDK.actions.pop(configurationDialogId(workspaceId))
                }
                catch {
                    NotificationSDK.toast.error('Could not destroy the workspace')
                }
            }}
        />
    ))
}
