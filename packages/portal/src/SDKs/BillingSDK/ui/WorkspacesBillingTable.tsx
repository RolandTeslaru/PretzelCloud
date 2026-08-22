import { useMemo } from 'react'
import {
    columnFilteringFeature,
    createColumnHelper,
    createFilteredRowModel,
    createSortedRowModel,
    rowSortingFeature,
    type ColumnDef,
    sortFn_basic,
    sortFn_datetime,
    tableFeatures,
    useTable,
} from '@tanstack/react-table'
import { Badge, Button, DropdownMenu, Table } from '@pretzel-graph/standard-ui/foundations'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import { Billing, type Workspace } from '@pretzel-cloud/shared/domain'
import { WorkspaceSDK } from '@/SDKs/WorkspaceSDK/sdk'
import { openWorkspaceConfigurationDialog } from '@/SDKs/WorkspaceSDK/ui/WorkspaceConfiguration'

const PLAN_VARIANT: Record<Workspace.Plan, 'success' | 'secondary' | 'outline'> = {
    free: 'outline',
    base: 'secondary',
    pro:  'success',
}

/** What the payment provider says, and whether it wants attention. */
const STATUS_VARIANT: Record<string, 'success' | 'destructive' | 'secondary' | 'outline'> = {
    active:   'success',
    trialing: 'secondary',
    past_due: 'destructive',
    unpaid:   'destructive',
    canceled: 'outline',
}

const features = tableFeatures({
    rowSortingFeature,
    sortedRowModel: createSortedRowModel(),
    sortFns: { datetime: sortFn_datetime, basic: sortFn_basic },

    columnFilteringFeature,
    filteredRowModel: createFilteredRowModel(),
})

const includesSome = (row: { getValue: (id: string) => unknown }, columnId: string, selected: unknown[]) =>
    selected.length === 0 || selected.includes(row.getValue(columnId))

// One definition per filterable column: the accessor the column reads through and
// the facet counts are the same function, so the dropdown cannot drift from the
// column it filters.
const FILTERABLE: Record<string, (w: Workspace) => unknown> = {
    plan:   w => w.plan,
    status: w => w.subscriptionStatus ?? 'none',
}

const columnHelper = createColumnHelper<typeof features, Workspace>()

// TValue stays loose: the columns hold a string union, a Date and a nullable
// string, which the ColumnDef union will not otherwise unify.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const columns: ColumnDef<typeof features, Workspace, any>[] = [
    columnHelper.accessor(row => row.displayName, {
        id: 'workspace',
        header: 'Workspace',
        sortFn: 'basic',
        enableColumnFilter: false,
        cell: ({ getValue }) => <span className='text-xs font-medium'>{getValue()}</span>,
    }),

    columnHelper.accessor(FILTERABLE.plan, {
        id: 'plan',
        header: 'Plan',
        enableSorting: false,
        filterFn: includesSome,
        cell: ({ getValue }) => {
            const plan = getValue() as Workspace.Plan

            return <span className='text-xs font-mono text-muted-foreground'>{Billing.getOfferForPlan(plan).label}</span>
        },
    }),

    columnHelper.accessor(row => Billing.getOfferForPlan(row.plan).price, {
        id: 'price',
        header: 'Price',
        enableSorting: false,
        enableColumnFilter: false,
        cell: ({ getValue }) => (
            <span className='text-xs font-mono text-muted-foreground'>{getValue()}/mo</span>
        ),
    }),

    columnHelper.accessor(FILTERABLE.status, {
        id: 'status',
        header: 'Subscription',
        enableSorting: false,
        filterFn: includesSome,
        cell: ({ getValue }) => {
            const status = getValue() as string

            if (status === 'none')
                return <span className='text-xs text-muted-foreground'>—</span>

            return <Badge variant={STATUS_VARIANT[status] ?? 'secondary'} size='sm'>{status}</Badge>
        },
    }),

    columnHelper.accessor(row => new Date(row.createdAt), {
        id: 'createdAt',
        header: 'Created',
        sortFn: 'datetime',
        enableColumnFilter: false,
        cell: ({ getValue }) => (
            <span className='text-xs text-muted-foreground'>{getValue().toLocaleDateString()}</span>
        ),
    }),

    columnHelper.accessor(row => row.id, {
        id: 'actions',
        header: '',
        enableSorting: false,
        enableColumnFilter: false,
        cell: ({ getValue }) => (
            <Button
                size='sm'
                variant='ghost'
                className='h-7 text-xs'
                onClick={() => openWorkspaceConfigurationDialog(getValue() as Workspace.Id, 'plan')}
            >
                Change plan
            </Button>
        ),
    }),
]

const HEAD_WIDTH: Record<string, string> = {
    plan:      'w-[110px]',
    price:     'w-[100px]',
    status:    'w-[130px]',
    createdAt: 'w-[120px]',
    actions:   'w-[120px] text-right',
}

const EMPTY_FACETS = new Map<unknown, number>()

export function WorkspacesBillingTable() {
    const workspaces = WorkspaceSDK.useStore((s) => Object.values(s.workspaces))

    const table = useTable(
        {
            features,
            columns,
            data: workspaces,
            initialState: { sorting: [{ id: 'workspace', desc: false }] },
        },
        s => ({ sorting: s.sorting, columnFilters: s.columnFilters }),
    )

    const rows       = table.getRowModel().rows
    const filters    = table.state.columnFilters
    const hasFilters = filters.length > 0

    // Counted from the rows rather than the table's faceting feature, which reads
    // a render-phase snapshot and lags. Each column's counts honour every other
    // column's filter.
    const facets = useMemo(() => {
        const byColumn: Record<string, Map<unknown, number>> = {}

        for (const [columnId, accessor] of Object.entries(FILTERABLE)) {
            const others = filters.filter(f => f.id !== columnId)
            const counts = new Map<unknown, number>()

            for (const workspace of workspaces) {
                const passesOthers = others.every(f => {
                    const otherAccessor = FILTERABLE[f.id]

                    if (!otherAccessor)
                        return true

                    return (f.value as unknown[]).includes(otherAccessor(workspace))
                })

                if (!passesOthers)
                    continue

                const value = accessor(workspace)
                counts.set(value, (counts.get(value) ?? 0) + 1)
            }

            byColumn[columnId] = counts
        }

        return byColumn
    }, [workspaces, filters])

    const emptyMessage =
        workspaces.length === 0 ? 'No workspaces yet.'
            : rows.length === 0 ? 'No workspaces match these filters.'
                : null

    return (
        <div className='flex flex-col gap-3'>

            <div className='flex items-center gap-2 h-8'>
                {hasFilters && (
                    <Button
                        variant='ghost'
                        size='sm'
                        className='h-8 text-xs'
                        onClick={() => table.resetColumnFilters()}
                    >
                        Reset filters
                    </Button>
                )}

                {workspaces.length > 0 && (
                    <span className='ml-auto text-xs text-muted-foreground'>
                        {rows.length} of {workspaces.length}
                    </span>
                )}
            </div>

            <Table.Root>
                <Table.Header>
                    {table.getHeaderGroups().map(group => (
                        <Table.Row key={group.id}>
                            {group.headers.map(header => (
                                <Table.Head key={header.id} className={HEAD_WIDTH[header.column.id]}>
                                    {header.column.getCanFilter()
                                        ? <FilterHeader
                                            column={header.column}
                                            filters={filters}
                                            facets={facets[header.column.id] ?? EMPTY_FACETS}
                                        />
                                        : header.column.getCanSort()
                                            ? (
                                                <button
                                                    className='flex items-center gap-1 hover:text-foreground transition-colors'
                                                    onClick={header.column.getToggleSortingHandler()}
                                                >
                                                    <table.FlexRender header={header} />
                                                    <SortIcon direction={header.column.getIsSorted()} />
                                                </button>
                                            )
                                            : <table.FlexRender header={header} />
                                    }
                                </Table.Head>
                            ))}
                        </Table.Row>
                    ))}
                </Table.Header>

                <Table.Body>
                    {emptyMessage
                        ? (
                            <Table.Row className='hover:bg-transparent'>
                                <Table.Cell colSpan={columns.length}>
                                    <div className='text-sm text-muted-foreground py-10 text-center'>
                                        {emptyMessage}
                                    </div>
                                </Table.Cell>
                            </Table.Row>
                        )
                        : rows.map(row => (
                            <Table.Row key={row.id}>
                                {row.getAllCells().map(cell => (
                                    <Table.Cell key={cell.id}>
                                        <table.FlexRender cell={cell} />
                                    </Table.Cell>
                                ))}
                            </Table.Row>
                        ))
                    }
                </Table.Body>
            </Table.Root>

        </div>
    )
}

type FilterColumn = {
    id: string
    columnDef: { header?: unknown }
    setFilterValue: (value: unknown) => void
}

type ColumnFilter = { id: string, value: unknown }

const FACET_LABEL: Record<string, (value: unknown) => string> = {
    plan:   value => Billing.getOfferForPlan(value as Workspace.Plan).label,
    status: value => value === 'none' ? 'Not subscribed' : String(value),
}

// Both `selected` and `facets` come from state the component subscribes to, never
// read live off the table during render — those reads are served from a snapshot
// that lags a frame behind.
function FilterHeader({ column, filters, facets }: {
    column: FilterColumn
    filters: ColumnFilter[]
    facets: Map<unknown, number>
}) {
    const selected = (filters.find(f => f.id === column.id)?.value as unknown[]) ?? []
    const label    = String(column.columnDef.header ?? column.id)
    const format   = FACET_LABEL[column.id] ?? String

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

function SortIcon({ direction }: { direction: false | 'asc' | 'desc' }) {
    if (!direction)
        return null

    return direction === 'asc'
        ? <SystemIcons.ChevronUp size={12} className='opacity-70' />
        : <SystemIcons.ChevronDown size={12} className='opacity-70' />
}
