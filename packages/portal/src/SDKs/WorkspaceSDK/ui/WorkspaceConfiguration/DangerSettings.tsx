import { AlertDialog, Button } from '@pretzel-graph/standard-ui/foundations'
import { DialogSDK } from '@pretzel-graph/standard-ui/SDKs/DialogSDK'
import { NotificationSDK } from '@pretzel-graph/standard-ui/SDKs/NotificationSDK'
import type { Workspace } from '@pretzel-cloud/shared/domain'
import { WorkspaceSDK } from '../../sdk'

const CONFIRM_ID = 'destroy-workspace'

export const DangerSettings = ({ workspaceId, dialogId }: { workspaceId: Workspace.Id; dialogId: string }) => {
    const workspace = WorkspaceSDK.useStore((s) => s.workspaces[workspaceId])

    if (!workspace) return null

    const confirm = () => {
        DialogSDK.actions.push(CONFIRM_ID, (props) => (
            <DialogSDK.AlertTemplate
                {...props}
                type="danger"
                approveLabel="Destroy"
                onCancel={() => DialogSDK.actions.pop(CONFIRM_ID)}
                onApprove={async () => {
                    DialogSDK.actions.pop(CONFIRM_ID)

                    try {
                        await WorkspaceSDK.actions.destroy(workspaceId)

                        NotificationSDK.toast.success(`${workspace.displayName} destroyed`)

                        // The settings it configured no longer exist.
                        DialogSDK.actions.pop(dialogId)
                    }
                    catch {
                        NotificationSDK.toast.error('Could not destroy the workspace')
                    }
                }}
            >
                <AlertDialog.Title>Destroy {workspace.displayName}?</AlertDialog.Title>
                <AlertDialog.Description>
                    Its database, its machine and everything built inside it are removed. Workflows,
                    executions and credentials in this workspace go with it. This cannot be undone.
                </AlertDialog.Description>
            </DialogSDK.AlertTemplate>
        ))
    }

    return (
        <div className="flex flex-col gap-3 pr-2">
            <div className="border-destructive/40 flex flex-col gap-3 rounded-lg border p-4">
                <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium">Destroy this workspace</p>
                    <p className="text-muted-foreground text-xs">
                        The machine is torn down and the database dropped. Nothing is recoverable
                        afterwards.
                    </p>
                </div>

                <Button variant="destructive" size="sm" className="mr-auto" onClick={confirm}>
                    Destroy workspace
                </Button>
            </div>
        </div>
    )
}
