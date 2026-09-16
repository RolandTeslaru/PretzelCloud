import { useState } from 'react'
import { AlertDialog, Button, ScrollArea, Spinner } from '@pretzel-graph/standard-ui/foundations'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import { DialogSDK } from '@pretzel-graph/standard-ui/SDKs/DialogSDK'
import { NotificationSDK } from '@pretzel-graph/standard-ui/SDKs/NotificationSDK'
import type { Workspace } from '@pretzel-cloud/shared/domain'
import { getMessageFromError } from '@/SDKs/api'
import { ReleaseSDK } from '@/SDKs/ReleaseSDK'
import { WorkspaceSDK } from '../sdk'

const UPDATE_CONFIRM_ID = 'update-workspace-confirm'

type Props = {
    dialogId: string
    workspaceId: Workspace.Id
}

export function UpdateWorkspaceDialog({ dialogId, workspaceId }: Props) {
    const workspace = WorkspaceSDK.useStore((s) => s.workspaces[workspaceId])

    const [latestRelease] = ReleaseSDK.useWith(
        (s) => s.latest,
        [ReleaseSDK.query.latest],
    )

    const [busy, setBusy] = useState(false)

    if (!workspace || !latestRelease)
        return null

    const onUpdate = async () => {
        setBusy(true)

        try {
            await WorkspaceSDK.actions.update(workspaceId, latestRelease.id)

            DialogSDK.actions.pop(dialogId)
        }
        catch (error) {
            NotificationSDK.toast.error(getMessageFromError(error, 'Could not update the workspace'))
        }
        finally {
            setBusy(false)
        }
    }

    const confirmUpdate = () => {
        DialogSDK.actions.push(UPDATE_CONFIRM_ID, (props) => (
            <DialogSDK.AlertTemplate
                {...props}
                type='warning'
                approveLabel='Update'
                onCancel={() => DialogSDK.actions.pop(UPDATE_CONFIRM_ID)}
                onApprove={async () => {
                    DialogSDK.actions.pop(UPDATE_CONFIRM_ID)

                    await onUpdate()
                }}
            >
                <AlertDialog.Title>Update {workspace.displayName}?</AlertDialog.Title>
                <AlertDialog.Description>
                    The workspace will be temporarily offline. Inbound requests are not
                    served, and anything running is stopped.
                </AlertDialog.Description>
            </DialogSDK.AlertTemplate>
        ))
    }

    return (
        <>
            <div className='absolute top-0 left-0 h-10 px-3 py-3'>
                <p className='text-sm font-medium'>
                    Update {workspace.displayName}
                </p>
            </div>
            <ScrollArea.Root className='h-[500px] relative [mask-image:linear-gradient(to_bottom,transparent,black_80px)]'>
                <div className='flex flex-col  px-3 pt-4 pb-10 pt-15'>

                    <div className='flex flex-row items-center gap-3'>
                        <div className='flex flex-col gap-1'>
                            <p className='text-xs text-muted-foreground'>Current</p>
                            <p className='text-sm font-mono'>{workspace.releaseName ?? 'Unknown'}</p>
                        </div>

                        <SystemIcons.ArrowRight className='size-4 text-muted-foreground mt-4' />

                        <div className='flex flex-col gap-1'>
                            <p className='text-xs text-muted-foreground'>Latest</p>
                            <p className='text-sm font-mono'>{latestRelease.name}</p>
                        </div>
                    </div>

                    {latestRelease.description && 
                        <div className='flex flex-col gap-2 pt-6'>
                            <p className='text-sm font-medium'>Changelog</p>
                            <p className='text-xs'>{latestRelease.description}</p>
                        </div>
                    }
                </div>

            </ScrollArea.Root>
            <div className='absolute bottom-0 right-0 p-3 z-10 flex flex-row justify-end gap-2 mt-auto'>
                <Button
                    type='button'
                    size='sm'
                    variant='ghost'
                    disabled={busy}
                    className='rounded-full'
                    onClick={() => DialogSDK.actions.pop(dialogId)}
                >
                    Cancel
                </Button>
                <Button
                    type='button'
                    size='sm'
                    disabled={busy}
                    className='rounded-full'
                    onClick={confirmUpdate}
                >
                    {busy && <Spinner className='mr-2 h-4 w-4' />}
                    Update
                </Button>
            </div>
        </>
    )
}
