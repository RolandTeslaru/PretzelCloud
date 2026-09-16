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
import { Badge, Button, Table } from '@pretzel-graph/standard-ui/foundations'
import { Plan, type Workspace } from '@pretzel-cloud/shared/domain'
import { FilterHeader, SortIcon, getFacets, includesSome } from '@/components/table-headers'
import { WorkspaceSDK } from '@/SDKs/WorkspaceSDK/sdk'

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

// One definition per filterable column: the accessor the column reads through and
// the facet counts are the same function, so the dropdown cannot drift from the
// column it filters.
const FILTERABLE: Record<string, (w: Workspace) => unknown> = {
    plan:   w => w.plan.displayName,
    status: w => w.subscriptionStatus ?? 'none',
}

/** How a facet value reads in the filter menu. */
const FACET_LABEL: Record<string, (value: unknown) => string> = {
    status: value => value === 'none' ? 'Not subscribed' : String(value),
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
        cell: ({ getValue }) => (
            <span className='text-xs font-mono text-muted-foreground'>{getValue() as string}</span>
        ),
    }),

    columnHelper.accessor(row => Plan.getPriceLabel(row.plan), {
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
                onClick={() => WorkspaceSDK.dialogs.openConfiguration(getValue() as Workspace.Id, 'plan')}
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
    const workspacesById = WorkspaceSDK.useStore((s) => s.workspaces)

    const workspaces = useMemo(() => Object.values(workspacesById), [workspacesById])

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

    const facets = useMemo(() => getFacets(workspaces, FILTERABLE, filters), [workspaces, filters])

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
                                            format={FACET_LABEL[header.column.id]}
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
