import { Admin, Plan, User, Workspace, type Listing } from '@pretzel-cloud/shared/domain'
import { DialogSDK } from '@pretzel-graph/standard-ui/SDKs/DialogSDK'
import { NotificationSDK } from '@pretzel-graph/standard-ui/SDKs/NotificationSDK'
import { AlertDialog } from '@pretzel-graph/standard-ui/foundations'
import { getMessageFromError } from '../api'
import { DeleteWorkspaceDialog } from './ui/DeleteWorkspaceDialog'
import { DeleteUserDialog } from './ui/DeleteUserDialog'
import { DisableWorkspaceDialog } from './ui/DisableWorkspaceDialog'
import { SetTemplateDialog } from './ui/SetTemplateDialog'
import { SetShelfBlueprintDialog } from './ui/SetShelfBlueprintDialog'
import type { AdminSDKImpl } from './sdk'

const deleteWorkspaceDialogId = (workspaceId: Workspace.Id) => `admin-delete-workspace-${workspaceId}`

const disableWorkspaceDialogId = (workspaceId: Workspace.Id) => `admin-disable-workspace-${workspaceId}`

const setPlanDialogId = (workspaceId: Workspace.Id) => `admin-set-plan-${workspaceId}`

const deleteUserDialogId = (userId: User.Id) => `admin-delete-user-${userId}`

const setTemplateDialogId = (listingId: Listing.Id) => `admin-set-template-${listingId}`

const setShelfBlueprintDialogId = (listingId: Listing.Id) => `admin-set-shelf-blueprint-${listingId}`

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

export const openDisableWorkspaceDialog = (sdk: AdminSDKImpl, summary: Admin.WorkspaceSummary) => {
    const id = disableWorkspaceDialogId(summary.workspace.id)

    DialogSDK.actions.push(id, (props) => (
        <DisableWorkspaceDialog
            {...props}
            summary={summary}
            onCancel={() => DialogSDK.actions.pop(id)}
            onConfirm={(reason) => {
                DialogSDK.actions.pop(id)

                void sdk.actions.workspaces.disable(summary.workspace.id, reason)
            }}
        />
    ))
}

export const openSetPlanDialog = (sdk: AdminSDKImpl, workspace: Workspace, plan: Plan) => {
    const id = setPlanDialogId(workspace.id)

    DialogSDK.actions.push(id, (props) => (
        <DialogSDK.AlertTemplate
            {...props}
            type='warning'
            approveLabel='Change plan'
            onCancel={() => DialogSDK.actions.pop(id)}
            onApprove={() => {
                DialogSDK.actions.pop(id)

                void sdk.actions.workspaces.setPlan(workspace.id, plan)
            }}
        >
            <AlertDialog.Title>Change {workspace.displayName} to {plan.displayName}?</AlertDialog.Title>

            <AlertDialog.Description>
                The new plan and limits take effect immediately. The workspace will stop, replace its service machines for the new plan, and then start again.
            </AlertDialog.Description>

            <ul className='mt-4 list-disc space-y-1 pl-5 text-sm text-muted-foreground'>
                <li>Running executions will stop during the change.</li>
                <li>The workspace will be temporarily unavailable.</li>
                <li>The database and workspace data will remain.</li>
                <li>Stripe will not be changed and the owner will not be charged.</li>
            </ul>

            <div className='mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm'>
                <span className='text-muted-foreground'>Current</span>
                <span>{workspace.plan.displayName} · {Plan.getPriceLabel(workspace.plan)}/month</span>
                <span className='text-muted-foreground'>New</span>
                <span>{plan.displayName} · {Plan.getPriceLabel(plan)}/month</span>
            </div>
        </DialogSDK.AlertTemplate>
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

export const openSetTemplateDialog = (sdk: AdminSDKImpl, listing: Admin.ListingSummary) => {
    const id = setTemplateDialogId(listing.id)

    DialogSDK.actions.push(id, (props) => (
        <SetTemplateDialog
            {...props}
            listing={listing}
            onCancel={() => DialogSDK.actions.pop(id)}
            onConfirm={(template) => {
                DialogSDK.actions.pop(id)

                void sdk.actions.listings.setTemplate(listing.id, template)
            }}
        />
    ))
}

export const openSetShelfBlueprintDialog = (sdk: AdminSDKImpl, listing: Admin.ListingSummary) => {
    const id = setShelfBlueprintDialogId(listing.id)

    DialogSDK.actions.push(id, (props) => (
        <SetShelfBlueprintDialog
            {...props}
            listing={listing}
            onCancel={() => DialogSDK.actions.pop(id)}
            onConfirm={(blueprintId) => {
                DialogSDK.actions.pop(id)

                void sdk.actions.listings.setShelfBlueprint(listing.id, blueprintId)
            }}
        />
    ))
}
