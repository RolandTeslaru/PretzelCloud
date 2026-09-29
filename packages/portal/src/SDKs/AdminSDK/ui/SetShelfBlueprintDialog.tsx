import { useState } from 'react'
import { Admin, ExtendedShelf } from '@pretzel-cloud/shared/domain'
import { AlertDialog, Input } from '@pretzel-graph/standard-ui/foundations'
import { DialogSDK } from '@pretzel-graph/standard-ui/SDKs/DialogSDK'

type Props = Omit<DialogSDK.AlertTemplateProps, 'onApprove'> & {
    listing: Admin.ListingSummary
    onConfirm: (blueprintId: string) => void
}

export const SetShelfBlueprintDialog = ({ listing, onConfirm, ...props }: Props) => {
    const [blueprintId, setBlueprintId] = useState(listing.blueprintId ?? '')

    const parsed = ExtendedShelf.API.Add.Request.safeParse({ blueprintId: blueprintId.trim() })

    return (
        <DialogSDK.AlertTemplate
            {...props}
            type='default'
            approveLabel={listing.blueprintId ? 'Save blueprint id' : 'Add to extended shelf'}
            approveDisabled={!parsed.success}
            onApprove={() => parsed.success && onConfirm(parsed.data.blueprintId)}
        >
            <AlertDialog.Title>Put {listing.name} on the extended shelf</AlertDialog.Title>

            <AlertDialog.Description>
                Every workspace shows it as a node under this blueprint id. Only listings of the shelf workspace can be added.
            </AlertDialog.Description>

            <div className='mt-4 text-sm space-y-1 break-all'>
                <p><span className='text-muted-foreground'>Workspace:</span> {listing.workspace.displayName}</p>
                <p className='font-mono text-xs text-muted-foreground'>{listing.id}</p>
            </div>

            <div className='flex flex-col gap-2 pt-4'>
                <p className='text-xs text-muted-foreground'>Blueprint id</p>
                <Input
                    value={blueprintId}
                    onChange={(event) => setBlueprintId(event.target.value)}
                    placeholder='Core.Agent'
                    aria-label='Extended shelf blueprint id'
                    autoFocus
                    size='sm'
                    spellCheck={false}
                />
            </div>
        </DialogSDK.AlertTemplate>
    )
}
