import { LazyTooltip } from '@pretzel-graph/standard-ui/foundations/LazyTooltip'
import { cn } from '@pretzel-graph/standard-ui/utils/cn'
import type { Workspace } from '@pretzel-cloud/shared/domain'

const LABEL = 'text-[10px] uppercase tracking-[0.14em] text-muted-foreground'

const formatDay = (day: Date) =>
    day.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** Executions per day over the billing period. One bar a day, days with none included. */
export function UsageBarChart({ points }: { points: Workspace.Usage.Point[] }) {
    if (points.length === 0)
        return null

    const peak  = Math.max(...points.map((p) => p.count))
    const first = points[0]
    const last  = points[points.length - 1]

    return (
        <div className='flex flex-col gap-3 w-full'>

            <span className={LABEL}>Executions per day</span>

            <div className='flex items-end gap-[2px] flex-1 min-h-[62px]'>
                {points.map((point, i) => (
                    <LazyTooltip
                        key={point.day.toISOString()}
                        content={
                            <span className='text-xs'>
                                {formatDay(point.day)} · {point.count} {point.count === 1 ? 'execution' : 'executions'}
                            </span>
                        }
                    >
                        {/* The column is the hover target, not the bar: a day
                            with nothing is a hairline and could not be hit. */}
                        <div className='group flex flex-1 items-end h-full cursor-default'>
                            <span
                                // A day with nothing keeps a hairline, so the axis
                                // reads as days rather than as gaps.
                                style={{ height: point.count === 0 ? '1px' : `${Math.max(4, (point.count / peak) * 100)}%` }}
                                className={cn(
                                    'w-full rounded-t-[1px] transition-colors group-hover:bg-foreground',
                                    point.count === 0 ? 'bg-muted-foreground/20'
                                        : i === points.length - 1 ? 'bg-orange-500'
                                            : 'bg-muted-foreground/40',
                                )}
                            />
                        </div>
                    </LazyTooltip>
                ))}
            </div>

            <div className='flex items-center gap-2'>
                <span className='text-[11px] uppercase tracking-[0.14em] tabular-nums text-muted-foreground'>
                    {formatDay(first.day)} – {formatDay(last.day)}
                </span>

                <span className='ml-auto text-[11px] uppercase tracking-[0.14em] tabular-nums'>
                    {peak}
                    <span className='text-muted-foreground'> peak</span>
                </span>
            </div>

        </div>
    )
}
