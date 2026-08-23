import { useState } from 'react'
import { AlertDialog, Input } from '@pretzel-graph/standard-ui/foundations'
import { DialogSDK } from '@pretzel-graph/standard-ui/SDKs/DialogSDK'

/** Typed out in full, so an account cannot go on a mis-click. */
const CONFIRMATION = 'I acknowledge that this action is irreversible'

/**
 * A component rather than markup passed to the dialog: what was typed has to
 * live somewhere, and a renderer is called during another component's render.
 */
export const DeleteAccountDialog = (props: DialogSDK.AlertTemplateProps) => {
    const [typed, setTyped] = useState('')

    // Capitals and stray spaces are not the point; typing it out is.
    const confirmed = typed.trim().toLowerCase() === CONFIRMATION.toLowerCase()

    return (
        <DialogSDK.AlertTemplate
            {...props}
            type='danger'
            approveLabel='Delete account'
            approveDisabled={!confirmed}
        >
            <AlertDialog.Title>Delete your account?</AlertDialog.Title>

            <AlertDialog.Description>
                Every workspace you own is destroyed with it, along with everything in them,
                and any subscription they carry is cancelled. This cannot be undone.
            </AlertDialog.Description>

            <div className='flex flex-col gap-2 pt-4'>
                <p className='text-xs text-muted-foreground'>
                    Type <span className='text-foreground font-medium'>{CONFIRMATION}</span> to continue.
                </p>

                <Input
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    autoFocus
                    autoComplete='off'
                    aria-label={CONFIRMATION}
                    // The brand ring reads as approval on a field that arms a deletion.
                    className='focus-visible:border-destructive focus-visible:ring-destructive/40'
                />
            </div>
        </DialogSDK.AlertTemplate>
    )
}
