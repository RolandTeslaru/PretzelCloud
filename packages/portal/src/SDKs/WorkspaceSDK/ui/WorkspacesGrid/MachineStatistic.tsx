import type { ComponentType } from 'react'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import type { Fleet } from '@pretzel-cloud/shared/domain'
import { Tooltip } from '@pretzel-graph/standard-ui/foundations'

const toMegabytes = (bytes: number) => Math.round(bytes / 1024 ** 2)

const ROLE_ICON: Record<Fleet.Machine.Role, ComponentType<{ className?: string }>> = {
    combined: SystemIcons.Cpu,
    backend:  SystemIcons.Server,
    worker:   SystemIcons.Cpu,
}

/** One machine's reading: live numbers while it runs, its state while it doesn't. */
export const MachineStatistic = ({ machineStatistics }: { machineStatistics: Fleet.Machine.Statistics }) => {
    const RoleIcon = ROLE_ICON[machineStatistics.role]

    const { cpuPercent, memUsedBytes, memTotalBytes } = machineStatistics

    const isComputeRunning = cpuPercent !== null && memUsedBytes !== null && memTotalBytes !== null

    return (
        <Tooltip.Root>
            <Tooltip.Trigger className='flex flex-row gap-1 shrink-0'>
                <div className='flex flex-row gap-2 bg-card/50 border border-border/50 px-1.5 py-1 rounded-sm'>
                    <RoleIcon className={`size-4 ${!isComputeRunning && "text-destructive"}`}/>
                    {isComputeRunning && (
                        <>
                            <p className='text-xs font-mono'>
                                CPU:
                                {Math.round(cpuPercent)}%
                            </p>
                            <p className='text-xs font-mono'>
                                MEM:
                                {Math.round(memUsedBytes / memTotalBytes * 100)}%
                            </p>
                        </>
                    ) }
                </div>
            </Tooltip.Trigger>
            <Tooltip.Content side="bottom" className='w-[200px]'>
                {isComputeRunning ? (
                    <div className='flex flex-col gap-2 text-xs font-mono'>
                        <div className='flex flex-row w-full justify-between'>
                            <p>
                                CPU USAGE:
                            </p>
                            <p>
                                {Math.round(cpuPercent)}%
                            </p>
                        </div>
                        <div className='flex flex-row w-full justify-between'>
                            <p>
                                MEMORY USAGE:
                            </p>
                            <p>
                                {Math.round(memUsedBytes / memTotalBytes * 100)}%
                            </p>
                        </div>
                        <div className='flex flex-row w-full justify-between'>
                            <p>
                                MEMORY USED:
                            </p>
                            <p>
                                {toMegabytes(memUsedBytes)}MB
                            </p>
                        </div>
                        <div className='flex flex-row w-full justify-between'>
                            <p>
                                MEMORY TOTAL:
                            </p>
                            <p>
                                {toMegabytes(memTotalBytes)}MB
                            </p>
                        </div>
                    </div>
                ) : (
                    <p className='text-center'>Machine is stopped</p>
                )}
            </Tooltip.Content>
        </Tooltip.Root>
    )
}
