import { useState } from 'react'
import { Button, Spinner } from '@pretzel-graph/standard-ui/foundations'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import { DialogSDK } from '@pretzel-graph/standard-ui/SDKs/DialogSDK'
import { NotificationSDK } from '@pretzel-graph/standard-ui/SDKs/NotificationSDK'
import type { Workspace } from '@pretzel-cloud/shared/domain'
import { getMessageFromError } from '@/SDKs/api'
import { ReleaseSDK } from '@/SDKs/ReleaseSDK'
import { WorkspaceSDK } from '../sdk'

type Props = {
    dialogId: string
    workspaceId: Workspace.Id
}

export function UpdateWorkspaceDialog({ dialogId, workspaceId }: Props) {
    const workspace = WorkspaceSDK.useStore((s) => s.workspaces[workspaceId])

    const latestRelease = ReleaseSDK.useStore((s) => s.latest)

    const [busy, setBusy] = useState(false)

    if (!workspace || !latestRelease)
        return null

    const onUpdate = async () => {
        setBusy(true)

        try {
            await WorkspaceSDK.actions.update(workspaceId)

            DialogSDK.actions.pop(dialogId)
        }
        catch (error) {
            NotificationSDK.toast.error(getMessageFromError(error, 'Could not update the workspace'))
        }
        finally {
            setBusy(false)
        }
    }

    return (
        <div className='flex flex-col gap-3 h-full pt-3'>
            <p className='text-sm font-medium'>
                Update {workspace.displayName}
            </p>

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

            <p className='text-xs text-muted-foreground'>
                The workspace goes offline while it updates. Requests will fail
                until it is back up, but nothing stored in it is lost.
            </p>

            <div className='flex flex-row justify-end gap-2 mt-auto'>
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
                    onClick={onUpdate}
                >
                    {busy && <Spinner className='mr-2 h-4 w-4' />}
                    Update
                </Button>
            </div>
        </div>
    )
}
