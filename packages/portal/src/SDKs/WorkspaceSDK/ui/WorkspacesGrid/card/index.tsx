import { Button, Frame, Tooltip } from '@pretzel-graph/standard-ui/foundations'
import { Card } from '@pretzel-graph/standard-ui/foundations/card'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import { ServerIllustration } from '@pretzel-graph/standard-ui/icons/illustrations'
import { cn } from '@pretzel-graph/standard-ui/utils/cn'
import type { Workspace } from '@pretzel-cloud/shared/domain'
import { WorkspaceSDK } from '../../../sdk'
import { StatusBadge, PlanBadge, isReachable, PROVISIONING_STEP } from '../../StatusBadge'
import { MachineStatistic } from '../MachineStatistic'
import { DatabaseStatistic } from '../DatabaseStatistic'
import { CardDropdown } from './dropdown'
import { ReleaseSDK } from '@/SDKs/ReleaseSDK'
import { ShinyText } from '@pretzel-graph/standard-ui/components/ShinyText'


export const WorkspaceCard = ({ workspace }: { workspace: Workspace }) => {

    const [transition, provision, rebuilding, hardwareStatistics] = WorkspaceSDK.useStore(s => [
        s.transitions[workspace.id],
        s.provisioning[workspace.id],
        s.rebuilding[workspace.id],
        s.hardwareStatistics[workspace.id]
    ])

    const reachable = isReachable(workspace, transition, rebuilding)

    const [latestRelease] = ReleaseSDK.use(
        (s) => s.latest,
        [ReleaseSDK.query.latest],
    )

    const updateAvailable = latestRelease !== null && workspace.releaseId !== null && workspace.releaseId !== latestRelease.id && workspace.lifecycleState !== "updating"


    return (
        <Frame.Root className=' w-full overflow-hidden'>
            <Frame.Panel
                className={cn('h-[100px] flex flex-col transition-shadow p-0 pt-3 pb-2', reachable ? 'cursor-pointer' : 'cursor-default')}
                aria-disabled={!reachable}
                onClick={reachable ? () => { window.location.href = workspace.appUrl } : undefined}
            >
                <Card.Header>
                    <div className={cn('flex flex-row gap-2', !reachable && 'opacity-60')}>
                        <ServerIllustration className='h-6' />
                        <Card.Title className='text-sm'>{workspace.displayName}</Card.Title>
                    </div>

                    <Card.Action onClick={(event) => event.stopPropagation()}>
                        <CardDropdown workspaceId={workspace.id} />
                    </Card.Action>
                </Card.Header>
                <Card.Content className='w-full mt-auto flex gap-1.5 relative'>
                    <StatusBadge workspace={workspace} />
                    <PlanBadge plan={workspace.plan} />

                    <div className="absolute right-4 -bottom-0 flex flex-row gap-2">
                        {updateAvailable &&
                            <>
                                <Button
                                    size="sm"
                                    variant="active"
                                    className='gap-2 animate-pulse'
                                    onClick={(event) => { event.stopPropagation(); WorkspaceSDK.dialogs.openUpdate(workspace.id) }}
                                >
                                    <SystemIcons.ArrowBigUpDash className='fill-current size-4' />
                                    Update
                                </Button>
                            </>
                        }
                        {workspace.disabledReason &&
                            <>
                                <Tooltip.Root>
                                    <Tooltip.Trigger>
                                        <SystemIcons.AlertTriangleFill className=' text-destructive animate-pulse size-5' />
                                    </Tooltip.Trigger>
                                    <Tooltip.Content className='max-w-[300px]'>
                                        {`This workspace has been disabled. ${workspace.disabledReason}`}
                                    </Tooltip.Content>
                                </Tooltip.Root>
                            </>
                        }
                    </div>
                </Card.Content>
            </Frame.Panel>
            <Frame.Footer className='flex flex-row gap-1 px-1! py-1! overflow-x-auto w-full h-[35px] [scrollbar-width:none]'>
                {provision ? (
                    <ShinyText text={PROVISIONING_STEP[provision]} className="text-sm font-medium my-auto pl-1.5" />
                ) : (
                    hardwareStatistics ? (
                        <>
                            {Object.entries(hardwareStatistics.machines).map(([machineId, machineStatistics]) => (
                                <MachineStatistic key={machineId} machineStatistics={machineStatistics} />
                            ))}
                            {hardwareStatistics.databaseSizeBytes !== null && (
                                <DatabaseStatistic databaseSizeBytes={hardwareStatistics.databaseSizeBytes} />
                            )}
                        </>
                    ) : (
                        <></>
                    )
                )}
            </Frame.Footer>
        </Frame.Root>
    )
}
