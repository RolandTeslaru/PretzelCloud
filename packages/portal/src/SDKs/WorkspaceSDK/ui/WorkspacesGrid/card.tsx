import { Button, DropdownMenu, Tooltip } from '@pretzel-graph/standard-ui/foundations'
import { Card } from '@pretzel-graph/standard-ui/foundations/card'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import { ServerIllustration } from '@pretzel-graph/standard-ui/icons/illustrations'
import { NotificationSDK } from '@pretzel-graph/standard-ui/SDKs/NotificationSDK'
import { cn } from '@pretzel-graph/standard-ui/utils/cn'
import type { Workspace } from '@pretzel-cloud/shared/domain'
import { WorkspaceSDK } from '../../sdk'
import { StatusBadge, PlanBadge, isReachable } from '../status'
import { AlertTriangle } from '@pretzel-graph/standard-ui/icons/system'

/**
 * Silent success is the wrong default for a copy: the whole point is pasting it
 * somewhere else, and the clipboard rejects outright without a secure context.
 */
const copyWorkspaceId = async (id: Workspace.Id) => {
    try {
        await navigator.clipboard.writeText(id)

        NotificationSDK.toast.success('Workspace ID copied')
    }
    catch {
        NotificationSDK.toast.error('Could not reach the clipboard')
    }
}

/**
 * Its own component so it can read its own transition, and so only the card that
 * changed re-renders. Opens the workspace only while the machine behind it is
 * up — a card that cannot answer is not a link.
 */
export const WorkspaceCard = ({ workspace }: { workspace: Workspace }) => {
    const transition = WorkspaceSDK.useStore((s) => s.transitions[workspace.id])

    const reachable = isReachable(workspace, transition)

    return (
        <Card.Root
            className={cn('w-[340px] transition-shadow', reachable ? 'cursor-pointer' : 'cursor-default')}
            aria-disabled={!reachable}
            // A full navigation, not a route change: the editor is a
            // separate origin with its own lifetime.
            onClick={reachable ? () => { window.location.href = workspace.appUrl } : undefined}
        >
            <Card.Header>
                {/* Dimmed while unreachable — but not the menu, which is how it gets started again. */}
                <div className={cn('flex flex-row gap-2', !reachable && 'opacity-60')}>
                    <ServerIllustration className='h-6'/>
                    <Card.Title className='text-sm'>{workspace.displayName}</Card.Title>
                </div>

                <Card.Action onClick={(event) => event.stopPropagation()}>
                    <DropdownMenu.Root>
                        <DropdownMenu.Trigger asChild>
                            <Button size="icon-xs" variant="ghost">
                                <SystemIcons.Ellipsis />
                            </Button>
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Content align='start' side="right">
                            <DropdownMenu.Item
                                className='gap-2 text-xs'
                                onClick={() => copyWorkspaceId(workspace.id)}
                            >
                                <SystemIcons.Copy />
                                Copy Workspace ID
                            </DropdownMenu.Item>
                            <DropdownMenu.Item
                                className='gap-2 text-xs'
                                onClick={() => WorkspaceSDK.openConfigurationDialog(workspace.id)}
                            >
                                <SystemIcons.Settings />
                                Open Configuration
                            </DropdownMenu.Item>
                            <DropdownMenu.Item
                                className='gap-2 text-xs'
                                onClick={() => WorkspaceSDK.openConfigurationDialog(workspace.id, 'plan')}
                            >
                                <SystemIcons.Sparkles />
                                Upgrade
                            </DropdownMenu.Item>
                        </DropdownMenu.Content>
                    </DropdownMenu.Root>
                </Card.Action>
            </Card.Header>
            <Card.Content className='w-full flex gap-1.5 relative'>
                <StatusBadge workspace={workspace} />
                <PlanBadge plan={workspace.plan} />

                {workspace.frozenReason && 
                    <>
                        <Tooltip.Root>
                            <Tooltip.Trigger className='absolute right-4 -bottom-2'>
                                <SystemIcons.AlertTriangleFill className=' text-destructive animate-pulse size-5'/>
                            </Tooltip.Trigger>
                            <Tooltip.Content className='max-w-[300px]'>
                                {`This workspace has been suspended. ${workspace.frozenReason}`}
                            </Tooltip.Content>
                        </Tooltip.Root>
                    </>
                }
            </Card.Content>
        </Card.Root>
    )
}
