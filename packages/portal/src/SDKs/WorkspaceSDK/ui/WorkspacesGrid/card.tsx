import { Button, DropdownMenu, Frame, Spinner, Tooltip } from '@pretzel-graph/standard-ui/foundations'
import { Card } from '@pretzel-graph/standard-ui/foundations/card'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import { ServerIllustration } from '@pretzel-graph/standard-ui/icons/illustrations'
import { NotificationSDK } from '@pretzel-graph/standard-ui/SDKs/NotificationSDK'
import { cn } from '@pretzel-graph/standard-ui/utils/cn'
import type { Workspace } from '@pretzel-cloud/shared/domain'
import { WorkspaceSDK } from '../../sdk'
import { StatusBadge, PlanBadge, isReachable, PROVISIONING_STEP } from '../status'
import { MachineStatistic } from './MachineStatistic'
import { DatabaseStatistic } from './DatabaseStatistic'
import { ReleaseSDK } from '@/SDKs/ReleaseSDK'
import { ShinyText } from '@pretzel-graph/standard-ui/components/ShinyText'


const copyWorkspaceId = async (id: Workspace.Id) => {
    try {
        await navigator.clipboard.writeText(id)

        NotificationSDK.toast.success('Workspace ID copied')
    }
    catch {
        NotificationSDK.toast.error('Could not reach the clipboard')
    }
}


export const WorkspaceCard = ({ workspace }: { workspace: Workspace }) => {

    const [transition, provision, rebuilding, hardwareStatistics] = WorkspaceSDK.useStore(s => [
        s.transitions[workspace.id], 
        s.provisioning[workspace.id], 
        s.rebuilding[workspace.id], 
        s.hardwareStatistics[workspace.id]
    ])

    const reachable = isReachable(workspace, transition, rebuilding)

    const latestRelease = ReleaseSDK.useStore((s) => s.latest)

    const updateAvailable = latestRelease !== null && workspace.releaseId !== null && workspace.releaseId !== latestRelease.id


    return (
        <Frame.Root className=' w-full overflow-hidden'>
            <Frame.Panel
                className={cn('h-[100px] flex flex-col transition-shadow p-0 pt-3 pb-2', reachable ? 'cursor-pointer' : 'cursor-default')}
                aria-disabled={!reachable}
                onClick={reachable ? () => { window.location.href = workspace.appUrl } : undefined}
            >
                    <Card.Header>
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
                    <Card.Content className='w-full mt-auto flex gap-1.5 relative'>
                        <StatusBadge workspace={workspace} />
                        <PlanBadge plan={workspace.plan} />

                        {workspace.disabledReason && 
                            <>
                                <Tooltip.Root>
                                    <Tooltip.Trigger className='absolute right-4 -bottom-2'>
                                        <SystemIcons.AlertTriangleFill className=' text-destructive animate-pulse size-5'/>
                                    </Tooltip.Trigger>
                                    <Tooltip.Content className='max-w-[300px]'>
                                        {`This workspace has been disabled. ${workspace.disabledReason}`}
                                    </Tooltip.Content>
                                </Tooltip.Root>
                            </>
                        }
                    </Card.Content>
            </Frame.Panel>
            <Frame.Footer className='flex flex-row gap-1 px-1! py-1! overflow-x-auto w-full h-[35px] [scrollbar-width:none]'>
                    {provision ? (
                        <ShinyText text={PROVISIONING_STEP[provision]} className="text-sm font-medium"/>
                    ) : (
                        hardwareStatistics ? (
                            <>
                                {Object.entries(hardwareStatistics.machines).map(([machineId, machineStatistics]) => (
                                    <MachineStatistic key={machineId} machineStatistics={machineStatistics}/>
                                ))}
                                {hardwareStatistics.databaseSizeBytes !== null && (
                                    <DatabaseStatistic databaseSizeBytes={hardwareStatistics.databaseSizeBytes}/>
                                )}
                                {updateAvailable && (
                                    <button
                                        className='flex flex-row gap-1 shrink-0 items-center bg-card/50 border border-border/50 px-1.5 py-1 rounded-sm cursor-pointer hover:bg-muted'
                                        onClick={(event) => { event.stopPropagation(); void WorkspaceSDK.actions.update(workspace.id) }}
                                        title={`Update to ${latestRelease.name}`}
                                    >
                                        <SystemIcons.ArrowUp className='size-4 text-primary'/>
                                        <p className='text-xs font-mono'>
                                            Update
                                        </p>
                                    </button>
                                )}
                            </>
                        ) : (
                            <></>
                        )
                    )}
                    {provision && (
                        <>
                            <ShinyText text={PROVISIONING_STEP[provision]} className="text-sm font-medium"/>
                        </>
                    )}
            </Frame.Footer>
        </Frame.Root>
    )
}
