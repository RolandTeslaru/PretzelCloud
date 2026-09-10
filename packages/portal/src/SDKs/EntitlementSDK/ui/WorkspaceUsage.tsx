import { useMemo } from 'react'
import { cn } from '@pretzel-graph/standard-ui/utils/cn'
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
import { QuerySDK } from '@pretzel-graph/standard-ui/SDKs/QuerySDK/sdk'
import { Select, Spinner, Table } from '@pretzel-graph/standard-ui/foundations'
import { Workspace } from '@pretzel-cloud/shared/domain'
import { FilterHeader, SortIcon, getFacets, includesSome } from '@/components/table-headers'
import { EntitlementSDK, DEFAULT_WINDOW } from '@/SDKs/EntitlementSDK'
import { UsageMeter } from './UsageMeter'
import { UsageBarChart } from './UsageBarChart'

const STALE_TIME = 30_000

const WINDOWS: { window: Workspace.Usage.Window, label: string }[] = [
    { window: 'today', label: 'Today' },
    { window: 'week', label: 'Last 7 days' },
    { window: 'month', label: 'Last 30 days' },
]

const features = tableFeatures({
    rowSortingFeature,
    sortedRowModel: createSortedRowModel(),
    sortFns: { datetime: sortFn_datetime, basic: sortFn_basic },

    columnFilteringFeature,
    filteredRowModel: createFilteredRowModel(),
})

const FILTERABLE: Record<string, (u: Workspace.Usage) => unknown> = {
    trigger: u => u.igniter ?? 'none',
}

const columnHelper = createColumnHelper<typeof features, Workspace.Usage>()

// TValue stays loose: the columns hold a Date, a string union and a nullable
// string, which the ColumnDef union will not otherwise unify.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const columns: ColumnDef<typeof features, Workspace.Usage, any>[] = [
    columnHelper.accessor(row => new Date(row.createdAt), {
        id: 'createdAt',
        header: 'Date',
        sortFn: 'datetime',
        enableColumnFilter: false,
        cell: ({ getValue }) => (
            <span className='text-xs text-muted-foreground'>{getValue().toLocaleString()}</span>
        ),
    }),

    columnHelper.accessor(FILTERABLE.trigger, {
        id: 'trigger',
        header: 'Igniter',
        enableSorting: false,
        filterFn: includesSome,
        cell: ({ getValue }) => {
            const igniter = getValue() as string

            if (igniter === 'none')
                return <span className='text-xs text-muted-foreground'>—</span>

            return <span className='text-xs font-mono text-muted-foreground'>{igniter}</span>
        },
    }),

    columnHelper.accessor(row => row.executionId, {
        id: 'execution',
        header: 'Execution Id',
        enableSorting: false,
        enableColumnFilter: false,
        cell: ({ getValue }) => {
            const id = getValue() as string | null

            if (!id)
                return <span className='text-xs text-muted-foreground'>—</span>

            return <span className='text-xs font-mono text-muted-foreground'>{id}</span>
        },
    }),
]

const HEAD_WIDTH: Record<string, string> = {
    createdAt: 'w-[180px]',
    trigger: 'w-[140px]',
}

// Applied to the header and its cells alike, so a column stays one column.
const COLUMN_ALIGN: Record<string, string> = {
    execution: 'text-right',
}

const EMPTY_FACETS = new Map<unknown, number>()
const NO_RECORDS: Workspace.Usage[] = []

/**
 * One workspace's executions: where it stands against its plan, and each run
 * over a chosen span.
 */
export function WorkspaceUsage({ workspace }: { workspace: Workspace }) {
    const window = EntitlementSDK.useStore((s) => s.windows[workspace.id]) ?? DEFAULT_WINDOW

    const { data: report } = QuerySDK.useQuery<Workspace.Usage.Report, Error>(
        ['usage', 'report', workspace.id],
        () => EntitlementSDK.actions.getUsageReport(workspace.id),
        { staleTime: STALE_TIME },
    )

    const { data: series } = QuerySDK.useQuery<Workspace.Usage.Point[], Error>(
        ['usage', 'series', workspace.id],
        () => EntitlementSDK.actions.getUsageSeries(workspace.id),
        { staleTime: STALE_TIME },
    )

    const recordsQuery = QuerySDK.useQuery<Workspace.Usage[], Error>(
        ['usage', 'records', workspace.id, window],
        () => EntitlementSDK.actions.listUsage(workspace.id, window),
        { staleTime: STALE_TIME },
    )

    const records = recordsQuery.data ?? NO_RECORDS

    const table = useTable(
        {
            features,
            columns,
            data: records,
            initialState: { sorting: [{ id: 'createdAt', desc: true }] },
        },
        s => ({ sorting: s.sorting, columnFilters: s.columnFilters }),
    )

    const rows = table.getRowModel().rows
    const filters = table.state.columnFilters

    const facets = useMemo(() => getFacets(records, FILTERABLE, filters), [records, filters])

    const emptyMessage =
        recordsQuery.isPending ? null
            : recordsQuery.error ? 'Could not load these executions.'
                : records.length === 0 ? 'Nothing ran in this window.'
                    : rows.length === 0 ? 'No executions match these filters.'
                        : null

    return (
        <section className='flex flex-col gap-6'>
            <h4 className='text-sm'>{workspace.displayName}</h4>

            <div className='flex items-stretch gap-10'>

                <div className='flex w-1/2'>
                    {report &&
                        <UsageMeter report={report} />
                    }
                </div>

                <div className='flex w-1/2'>
                    {series &&
                        <UsageBarChart points={series} />
                    }
                </div>
            </div>

            <div className='flex'>
                <Select.Root
                    value={window}
                    onValueChange={(value) => EntitlementSDK.actions.setWindow(workspace.id, value as Workspace.Usage.Window)}
                >
                    <Select.Trigger size='xs' className='ml-auto w-[140px]'>
                        <Select.Value />
                    </Select.Trigger>

                    <Select.Content align='end'>
                        {WINDOWS.map(({ window: value, label }) => (
                            <Select.Item key={value} value={value} size='xs'>{label}</Select.Item>
                        ))}
                    </Select.Content>
                </Select.Root>
            </div>

            <Table.Root>
                <Table.Header>
                    {table.getHeaderGroups().map(group => (
                        <Table.Row key={group.id}>
                            {group.headers.map(header => (
                                <Table.Head key={header.id} className={cn(HEAD_WIDTH[header.column.id], COLUMN_ALIGN[header.column.id])}>
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
                    {recordsQuery.isPending
                        ? (
                            <Table.Row className='hover:bg-transparent'>
                                <Table.Cell colSpan={columns.length}>
                                    <div className='flex justify-center py-10'>
                                        <Spinner className='size-4' />
                                    </div>
                                </Table.Cell>
                            </Table.Row>
                        )
                        : emptyMessage
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
                                        <Table.Cell key={cell.id} className={COLUMN_ALIGN[cell.column.id]}>
                                            <table.FlexRender cell={cell} />
                                        </Table.Cell>
                                    ))}
                                </Table.Row>
                            ))
                    }
                </Table.Body>
            </Table.Root>

        </section>
    )
}
