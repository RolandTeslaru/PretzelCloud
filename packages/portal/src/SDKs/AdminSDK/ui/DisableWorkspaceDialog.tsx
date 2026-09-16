import { useState } from 'react'
import { Admin } from '@pretzel-cloud/shared/domain'
import { AlertDialog, Textarea } from '@pretzel-graph/standard-ui/foundations'
import { DialogSDK } from '@pretzel-graph/standard-ui/SDKs/DialogSDK'

type Props = Omit<DialogSDK.AlertTemplateProps, 'onApprove'> & {
    summary: Admin.WorkspaceSummary
    onConfirm: (reason: string) => void
}

export const DisableWorkspaceDialog = ({ summary: { workspace, owner }, onConfirm, ...props }: Props) => {
    const [reason, setReason] = useState('')

    const trimmedReason = reason.trim()

    return (
        <DialogSDK.AlertTemplate
            {...props}
            type='warning'
            approveLabel='Disable workspace'
            approveDisabled={!trimmedReason}
            onApprove={() => onConfirm(trimmedReason)}
        >
            <AlertDialog.Title>Disable {workspace.displayName}?</AlertDialog.Title>

            <AlertDialog.Description>
                Its hardware will stop, traffic will be rejected, and the owner cannot start it again until an admin enables it.
            </AlertDialog.Description>

            <div className='mt-4 text-sm space-y-1 break-all'>
                <p><span className='text-muted-foreground'>Owner:</span> {owner.email}</p>
                <p className='font-mono text-xs text-muted-foreground'>{workspace.id}</p>
            </div>

            <div className='flex flex-col gap-2 pt-4'>
                <p className='text-xs text-muted-foreground'>Reason shown to the workspace owner</p>
                <Textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder='Why is this workspace being disabled?'
                    aria-label='Reason for disabling this workspace'
                    autoFocus
                    size='sm'
                />
            </div>
        </DialogSDK.AlertTemplate>
    )
}
