import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import { Tooltip } from '@pretzel-graph/standard-ui/foundations'

const toMegabytes = (bytes: number) => Math.round(bytes / 1024 ** 2)

/** The workspace database's footprint on its cluster. */
export const DatabaseStatistic = ({ databaseSizeBytes }: { databaseSizeBytes: number }) => {
    return (
        <Tooltip.Root>
            <Tooltip.Trigger className='flex flex-row gap-1 shrink-0'>
                <div className='flex flex-row gap-2 bg-card/50 border border-border/50 px-1.5 py-1 rounded-sm'>
                    <SystemIcons.Database className='size-4'/>
                    <p className='text-xs font-mono'>
                        {toMegabytes(databaseSizeBytes)} MB
                    </p>
                </div>
            </Tooltip.Trigger>
            <Tooltip.Content side="bottom" className='w-[200px]'>
                <div className='flex flex-col gap-2 text-xs font-mono'>
                    <div className='flex flex-row w-full justify-between'>
                        <p>
                            DATABASE SIZE:
                        </p>
                        <p>
                            {toMegabytes(databaseSizeBytes)} MB
                        </p>
                    </div>
                </div>
            </Tooltip.Content>
        </Tooltip.Root>
    )
}
