import { useState } from 'react'
import { Admin } from '@pretzel-cloud/shared/domain'
import { AlertDialog, Input } from '@pretzel-graph/standard-ui/foundations'
import { DialogSDK } from '@pretzel-graph/standard-ui/SDKs/DialogSDK'

type Props = Omit<DialogSDK.AlertTemplateProps, 'onApprove'> & {
    summary:   Admin.WorkspaceSummary
    onConfirm: (confirmation: string) => void
}

/** Holds what was typed; the caller decides what approving does with it. */
export const DeleteWorkspaceDialog = ({ summary: { workspace, owner }, onConfirm, ...props }: Props) => {
    const [typed, setTyped] = useState('')

    const confirmed = typed.trim() === workspace.displayName.trim()

    return (
        <DialogSDK.AlertTemplate
            {...props}
            type='danger'
            approveLabel='Delete workspace'
            approveDisabled={!confirmed}
            onApprove={() => onConfirm(typed)}
        >
            <AlertDialog.Title>Delete {workspace.displayName}?</AlertDialog.Title>

            <AlertDialog.Description>
                This permanently deletes the workspace, its workflows, executions, credentials,
                and stored data. Its subscription is cancelled. This cannot be undone.
            </AlertDialog.Description>

            <div className='mt-4 text-sm space-y-1 break-all'>
                <p><span className='text-muted-foreground'>Owner:</span> {owner.email}</p>
                <p className='font-mono text-xs text-muted-foreground'>{workspace.id}</p>
            </div>

            <div className='flex flex-col gap-2 pt-4'>
                <p className='text-xs text-muted-foreground'>
                    Type <span className='text-foreground font-medium'>{workspace.displayName}</span> to confirm.
                </p>

                <Input
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    autoFocus
                    autoComplete='off'
                    aria-label={`Type ${workspace.displayName} to confirm`}
                    className='focus-visible:border-destructive focus-visible:ring-destructive/40'
                />
            </div>
        </DialogSDK.AlertTemplate>
    )
}
