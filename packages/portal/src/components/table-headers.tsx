import { useMemo } from 'react'
import { Badge, DropdownMenu } from '@pretzel-graph/standard-ui/foundations'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'

/** A filter that keeps rows whose value is among those ticked. Empty keeps all. */
export const includesSome = (row: { getValue: (id: string) => unknown }, columnId: string, selected: unknown[]) =>
    selected.length === 0 || selected.includes(row.getValue(columnId))

type FilterColumn = {
    id: string
    columnDef: { header?: unknown }
    setFilterValue: (value: unknown) => void
}

export type ColumnFilter = { id: string, value: unknown }

// Both `selected` and `facets` come from state the component subscribes to, never
// read live off the table during render — those reads are served from a snapshot
// that lags a frame behind.
export function FilterHeader({ column, filters, facets, format = String }: {
    column: FilterColumn
    filters: ColumnFilter[]
    facets: Map<unknown, number>
    format?: (value: unknown) => string
}) {
    const selected = (filters.find(f => f.id === column.id)?.value as unknown[]) ?? []
    const label    = String(column.columnDef.header ?? column.id)

    const options = useMemo(
        () => [...facets.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        [facets],
    )

    const toggle = (value: unknown) => {
        const next = selected.includes(value)
            ? selected.filter(v => v !== value)
            : [...selected, value]

        column.setFilterValue(next.length > 0 ? next : undefined)
    }

    return (
        <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
                <button
                    data-filtered={selected.length > 0 || undefined}
                    className='flex items-center gap-1 hover:text-foreground transition-colors data-[filtered]:text-foreground'
                >
                    {label}

                    {selected.length > 0 && (
                        <Badge variant='secondary' size='xs'>
                            {selected.length}
                        </Badge>
                    )}

                    <SystemIcons.ChevronDown size={12} className='opacity-40' />
                </button>
            </DropdownMenu.Trigger>

            <DropdownMenu.Content align='start' className='min-w-[180px]'>
                {options.length === 0 && (
                    <div className='px-2 py-1.5 text-xs text-muted-foreground'>
                        No values
                    </div>
                )}

                {options.map(([value, count]) => (
                    <DropdownMenu.CheckboxItem
                        key={String(value)}
                        checked={selected.includes(value)}
                        onCheckedChange={() => toggle(value)}
                        onSelect={e => e.preventDefault()}
                        className='text-xs data-[state=checked]:text-foreground data-[state=checked]:font-medium'
                    >
                        <span>{format(value)}</span>
                        <span className='ml-auto text-muted-foreground'>{count}</span>
                    </DropdownMenu.CheckboxItem>
                ))}
            </DropdownMenu.Content>
        </DropdownMenu.Root>
    )
}

export function SortIcon({ direction }: { direction: false | 'asc' | 'desc' }) {
    if (!direction)
        return null

    return direction === 'asc'
        ? <SystemIcons.ChevronUp size={12} className='opacity-70' />
        : <SystemIcons.ChevronDown size={12} className='opacity-70' />
}

/**
 * Facet counts per filterable column, taken from the rows rather than the
 * table's faceting feature, which reads a render-phase snapshot and lags. Each
 * column's counts honour every other column's filter.
 */
export function getFacets<T>(rows: T[], accessors: Record<string, (row: T) => unknown>, filters: ColumnFilter[]) {
    const byColumn: Record<string, Map<unknown, number>> = {}

    for (const [columnId, accessor] of Object.entries(accessors)) {
        const others = filters.filter(f => f.id !== columnId)
        const counts = new Map<unknown, number>()

        for (const row of rows) {
            const passesOthers = others.every(f => {
                const otherAccessor = accessors[f.id]

                if (!otherAccessor)
                    return true

                return (f.value as unknown[]).includes(otherAccessor(row))
            })

            if (!passesOthers)
                continue

            const value = accessor(row)
            counts.set(value, (counts.get(value) ?? 0) + 1)
        }

        byColumn[columnId] = counts
    }

    return byColumn
}
