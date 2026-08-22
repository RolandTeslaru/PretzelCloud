import { useEffect, useRef, useState } from 'react'
import { cn } from '@pretzel-graph/standard-ui/utils/cn'
import type { Workspace } from '@pretzel-cloud/shared/domain'

// One tick every 5px: a 2px bar and a 3px gap. Ticks are counted from the
// rendered width so they stay this thin however wide the column gets.
const TICK_PITCH = 5
const MIN_TICKS  = 40
const MAX_TICKS  = 400

const LABEL = 'text-[10px] uppercase tracking-[0.14em] text-muted-foreground'

/** How much is left, said in colour: comfortable, getting low, nearly out. */
const getTickColour = (fraction: number) =>
    fraction > 0.4  ? 'bg-emerald-500'
        : fraction >= 0.2 ? 'bg-amber-400'
            : 'bg-red-500'

const format = (value: number) => value.toLocaleString()

const formatSince = (period: Workspace.Usage.Period) =>
    period.start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/**
 * How much of the period's allowance is left, as a tick bar that empties as it
 * is spent. Nothing is drawn for an unlimited plan — a bar with no end has no
 * fill to show.
 */
function useTickCount() {
    const ref = useRef<HTMLDivElement>(null)
    const [ticks, setTicks] = useState(MIN_TICKS)

    useEffect(() => {
        const element = ref.current

        if (!element)
            return

        const observer = new ResizeObserver(([entry]) => {
            const count = Math.floor(entry.contentRect.width / TICK_PITCH)

            setTicks(Math.max(MIN_TICKS, Math.min(MAX_TICKS, count)))
        })

        observer.observe(element)

        return () => observer.disconnect()
    }, [])

    return { ref, ticks }
}

export function UsageMeter({ report }: { report: Workspace.Usage.Report }) {
    const { ref, ticks } = useTickCount()

    if (report.limit === null)
        return (
            <div className='flex flex-col gap-1'>
                <span className={LABEL}>Executions left</span>

                <div className='flex items-baseline gap-2'>
                    <span className='text-4xl font-light'>Unlimited</span>
                    <span className={LABEL}>{format(report.used)} used since {formatSince(report.period)}</span>
                </div>
            </div>
        )

    const remaining = report.remaining ?? 0
    const fraction  = report.limit === 0 ? 0 : Math.max(0, Math.min(1, remaining / report.limit))
    // Anything left lights at least one tick: a large limit rounds the last few
    // to nothing, and an empty bar beside a non-zero count reads as spent.
    const filled    = remaining === 0 ? 0 : Math.max(1, Math.round(fraction * ticks))

    return (
        <div className='flex flex-col gap-3 w-full'>

            <div className='flex items-center gap-4'>
                <div className='flex flex-col gap-0.5'>
                    <span className={LABEL}>Executions left</span>

                    <span className='text-4xl font-light tabular-nums leading-none'>
                        {(fraction * 100).toFixed(1)}%
                    </span>
                </div>
            </div>

            <div ref={ref} className='flex items-stretch justify-between h-6'>
                {Array.from({ length: ticks }, (_, i) => (
                    <span
                        key={i}
                        className={cn(
                            'w-[2px] shrink-0 rounded-[1px]',
                            i < filled ? getTickColour(fraction) : 'bg-muted-foreground/20',
                        )}
                    />
                ))}
            </div>

            <div className='flex items-center gap-2'>
                <span className='text-[11px] uppercase tracking-[0.14em] tabular-nums'>
                    {format(remaining)}
                    <span className='text-muted-foreground'> / {format(report.limit)} executions left</span>
                </span>

                <span className='ml-auto text-[11px] uppercase tracking-[0.14em] tabular-nums'>
                    {format(report.used)}
                    <span className='text-muted-foreground'> used since {formatSince(report.period)}</span>
                </span>
            </div>

        </div>
    )
}
