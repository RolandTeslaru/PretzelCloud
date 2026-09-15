import { useState } from 'react'
import { Admin } from '@pretzel-cloud/shared/domain'
import { AlertDialog, Input } from '@pretzel-graph/standard-ui/foundations'
import { DialogSDK } from '@pretzel-graph/standard-ui/SDKs/DialogSDK'

type Props = Omit<DialogSDK.AlertTemplateProps, 'onApprove'> & {
    user:      Admin.UserSummary
    onConfirm: (confirmation: string) => void
}

/** Holds what was typed; the caller decides what approving does with it. */
export const DeleteUserDialog = ({ user, onConfirm, ...props }: Props) => {
    const [typed, setTyped] = useState('')

    const confirmed = typed.trim().toLowerCase() === user.email.trim().toLowerCase()

    const ownedWorkspaces = user.ownedWorkspaceCount === 1 ? '1 workspace' : `${user.ownedWorkspaceCount} workspaces`

    return (
        <DialogSDK.AlertTemplate
            {...props}
            type='danger'
            approveLabel='Delete user'
            approveDisabled={!confirmed}
            onApprove={() => onConfirm(typed)}
        >
            <AlertDialog.Title>Delete {user.displayName}?</AlertDialog.Title>

            <AlertDialog.Description>
                This permanently deletes the account and its login.
                {user.ownedWorkspaceCount > 0
                    ? ` Their ${ownedWorkspaces} are deleted with it, including workflows, executions, credentials, and stored data, and any subscriptions are cancelled.`
                    : ' They own no workspaces.'}
                {' '}They are also removed from every workspace they joined. This cannot be undone.
            </AlertDialog.Description>

            <div className='mt-4 text-sm space-y-1 break-all'>
                <p><span className='text-muted-foreground'>Email:</span> {user.email}</p>
                <p className='font-mono text-xs text-muted-foreground'>{user.id}</p>
            </div>

            <div className='flex flex-col gap-2 pt-4'>
                <p className='text-xs text-muted-foreground'>
                    Type <span className='text-foreground font-medium'>{user.email}</span> to confirm.
                </p>

                <Input
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    autoFocus
                    autoComplete='off'
                    aria-label={`Type ${user.email} to confirm`}
                    className='focus-visible:border-destructive focus-visible:ring-destructive/40'
                />
            </div>
        </DialogSDK.AlertTemplate>
    )
}
