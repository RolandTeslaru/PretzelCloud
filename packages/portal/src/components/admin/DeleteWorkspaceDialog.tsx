import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Admin } from '@pretzel-cloud/shared/domain'
import { AlertDialog, Input } from '@pretzel-graph/standard-ui/foundations'
import { DialogSDK } from '@pretzel-graph/standard-ui/SDKs/DialogSDK'
import { NotificationSDK } from '@pretzel-graph/standard-ui/SDKs/NotificationSDK'
import { api, getMessageFromError } from '@/SDKs/api'

type Props = DialogSDK.AlertTemplateProps & { summary: Admin.WorkspaceSummary }

export function DeleteWorkspaceDialog({ summary: { workspace, owner }, ...props }: Props) {
    const [confirmation, setConfirmation] = useState('')
    const queryClient = useQueryClient()
    const deletion = useMutation({
        mutationFn: () => Admin.API.destroy(api, workspace.id, { confirmation }),
        onSuccess: () => {
            queryClient.setQueriesData<Admin.API.List.Response>({ queryKey: ['admin', 'workspaces'] }, (current) =>
                current ? { workspaces: current.workspaces.filter((row) => row.workspace.id !== workspace.id) } : current)
            void queryClient.invalidateQueries({ queryKey: ['admin', 'workspaces'] })
            void queryClient.invalidateQueries({ queryKey: ['workspaces'] })
            NotificationSDK.toast.success(`${workspace.displayName} deleted`)
            DialogSDK.actions.pop(props.entry.dialogId)
        },
    })
    const confirmed = confirmation.trim() === workspace.displayName.trim()

    return (
        <DialogSDK.AlertTemplate
            {...props}
            type="danger"
            dismissible={!deletion.isPending}
            approveLabel={deletion.isPending ? 'Deleting…' : 'Delete workspace'}
            approveDisabled={!confirmed || deletion.isPending}
            onApprove={(event) => {
                event.preventDefault()
                if (confirmed && !deletion.isPending) deletion.mutate()
            }}
            onCancel={(event) => {
                event.preventDefault()
                if (!deletion.isPending) DialogSDK.actions.pop(props.entry.dialogId)
            }}
        >
            <AlertDialog.Title>Delete {workspace.displayName}?</AlertDialog.Title>
            <AlertDialog.Description>
                This permanently deletes the workspace, its workflows, executions, credentials,
                and stored data. Its subscription will be cancelled. This cannot be undone.
            </AlertDialog.Description>
            <div className="mt-4 rounded-lg border border-border p-3 text-sm space-y-1 break-all">
                <p><span className="text-muted-foreground">Owner:</span> {owner.email}</p>
                <p className="font-mono text-xs text-muted-foreground">{workspace.id}</p>
            </div>
            <div className="flex flex-col gap-2 pt-4">
                <label htmlFor="admin-delete-confirmation" className="text-sm text-muted-foreground">
                    Type <strong className="text-foreground">{workspace.displayName}</strong> to confirm.
                </label>
                <Input
                    id="admin-delete-confirmation"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    disabled={deletion.isPending}
                    autoFocus
                    autoComplete="off"
                    className="focus-visible:border-destructive focus-visible:ring-destructive/40"
                />
                {deletion.isPending && <p role="status" className="text-xs text-muted-foreground">Deleting the workspace and its resources. This may take a moment.</p>}
                {deletion.isError && <p role="alert" className="text-sm text-destructive">{getMessageFromError(deletion.error, 'Could not delete the workspace. Please retry.')}</p>}
            </div>
        </DialogSDK.AlertTemplate>
    )
}
