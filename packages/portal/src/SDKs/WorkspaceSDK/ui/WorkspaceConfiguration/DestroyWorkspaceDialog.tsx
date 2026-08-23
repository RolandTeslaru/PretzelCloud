import { useState } from 'react'
import { AlertDialog, Input } from '@pretzel-graph/standard-ui/foundations'
import { DialogSDK } from '@pretzel-graph/standard-ui/SDKs/DialogSDK'

type Props = DialogSDK.AlertTemplateProps & {
    displayName: string
}

/**
 * A component rather than markup passed to the dialog: what was typed has to
 * live somewhere, and a renderer is called during another component's render.
 */
export const DestroyWorkspaceDialog = ({ displayName, ...props }: Props) => {
    const [typed, setTyped] = useState('')

    // Capitals and stray spaces are not the point; naming the workspace is.
    const confirmed = typed.trim().toLowerCase() === displayName.trim().toLowerCase()

    return (
        <DialogSDK.AlertTemplate
            {...props}
            type='danger'
            approveLabel='Destroy'
            approveDisabled={!confirmed}
        >
            <AlertDialog.Title>Destroy {displayName}?</AlertDialog.Title>

            <AlertDialog.Description>
                Everything built inside it goes with it — workflows, executions and
                credentials. This cannot be undone.
            </AlertDialog.Description>

            <div className='flex flex-col gap-2 pt-4'>
                <p className='text-xs text-muted-foreground'>
                    Type <span className='text-foreground font-medium'>{displayName}</span> to continue.
                </p>

                <Input
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    autoFocus
                    autoComplete='off'
                    aria-label={`Type ${displayName} to confirm`}
                    // The brand ring reads as approval on a field that arms a teardown.
                    className='focus-visible:border-destructive focus-visible:ring-destructive/40'
                />
            </div>
        </DialogSDK.AlertTemplate>
    )
}
