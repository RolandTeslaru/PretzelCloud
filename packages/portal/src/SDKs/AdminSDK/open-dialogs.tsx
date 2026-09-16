import { Admin, User, Workspace } from '@pretzel-cloud/shared/domain'
import { DialogSDK } from '@pretzel-graph/standard-ui/SDKs/DialogSDK'
import { NotificationSDK } from '@pretzel-graph/standard-ui/SDKs/NotificationSDK'
import { getMessageFromError } from '../api'
import { DeleteWorkspaceDialog } from './ui/DeleteWorkspaceDialog'
import { DeleteUserDialog } from './ui/DeleteUserDialog'
import type { AdminSDKImpl } from './sdk'

const deleteWorkspaceDialogId = (workspaceId: Workspace.Id) => `admin-delete-workspace-${workspaceId}`

const deleteUserDialogId = (userId: User.Id) => `admin-delete-user-${userId}`

// Confirms by name, closes at once, and reports the outcome as a toast.
export const openDeleteWorkspaceDialog = (sdk: AdminSDKImpl, summary: Admin.WorkspaceSummary, onDeleted?: () => void) => {
    const { workspace } = summary

    const id = deleteWorkspaceDialogId(workspace.id)

    DialogSDK.actions.push(id, (props) => (
        <DeleteWorkspaceDialog
            {...props}
            summary={summary}
            onCancel={() => DialogSDK.actions.pop(id)}
            onConfirm={async (confirmation) => {
                DialogSDK.actions.pop(id)

                try {
                    await sdk.actions.workspaces.destroy(workspace.id, confirmation)

                    NotificationSDK.toast.success(`${workspace.displayName} deleted`)

                    onDeleted?.()
                }
                catch (error) {
                    NotificationSDK.toast.error(`Could not delete ${workspace.displayName}`, { description: getMessageFromError(error) })
                }
            }}
        />
    ))
}

// Confirms by email, closes at once, and reports the outcome as a toast.
export const openDeleteUserDialog = (sdk: AdminSDKImpl, user: Admin.UserSummary) => {
    const id = deleteUserDialogId(user.id)

    DialogSDK.actions.push(id, (props) => (
        <DeleteUserDialog
            {...props}
            user={user}
            onCancel={() => DialogSDK.actions.pop(id)}
            onConfirm={async (confirmation) => {
                DialogSDK.actions.pop(id)

                try {
                    await sdk.actions.users.delete(user.id, confirmation)

                    NotificationSDK.toast.success(`${user.email} deleted`)
                }
                catch (error) {
                    NotificationSDK.toast.error(`Could not delete ${user.email}`, { description: getMessageFromError(error) })
                }
            }}
        />
    ))
}
