import { useMemo } from 'react'
import {
    createColumnHelper,
    createSortedRowModel,
    rowSortingFeature,
    type ColumnDef,
    sortFn_basic,
    sortFn_datetime,
    tableFeatures,
    useTable,
} from '@tanstack/react-table'
import { Table } from '@pretzel-graph/standard-ui/foundations'
import type { User } from '@pretzel-cloud/shared/domain'
import { SortIcon } from '@/components/table-headers'

type MemberRow = User & { role: 'Owner' | 'Member' }

const features = tableFeatures({
    rowSortingFeature,
    sortedRowModel: createSortedRowModel(),
    sortFns: { datetime: sortFn_datetime, basic: sortFn_basic },
})

const columnHelper = createColumnHelper<typeof features, MemberRow>()

// TValue stays loose because the columns contain strings and dates.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const columns: ColumnDef<typeof features, MemberRow, any>[] = [
    columnHelper.accessor(row => row.displayName, {
        id: 'member',
        header: 'Member',
        sortFn: 'basic',
        cell: ({ row, getValue }) => (
            <>
                <p className='font-medium break-words'>{getValue()}</p>
                <p className='mt-1 text-xs text-muted-foreground'>@{row.original.username}</p>
            </>
        ),
    }),
    columnHelper.accessor(row => row.email, {
        id: 'email',
        header: 'Email',
        sortFn: 'basic',
        cell: ({ getValue }) => <span className='break-all'>{getValue()}</span>,
    }),
    columnHelper.accessor(row => row.role, {
        id: 'role',
        header: 'Role',
        sortFn: 'basic',
        cell: ({ getValue }) => (
            <span className='inline-block rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground'>
                {getValue()}
            </span>
        ),
    }),
    columnHelper.accessor(row => row.createdAt, {
        id: 'joined',
        header: 'Joined',
        sortFn: 'datetime',
        cell: ({ getValue }) => (
            <span className='whitespace-nowrap text-xs text-muted-foreground'>
                {getValue().toLocaleDateString()}
            </span>
        ),
    }),
]

const HEAD_WIDTH: Record<string, string> = {
    role:   'w-[100px]',
    joined: 'w-[120px]',
}

export const AdminWorkspaceMembers = ({ members, ownerId }: {
    members: User[]
    ownerId: User.Id
}) => {
    const data = useMemo(() => members.map((member) => ({
        ...member,
        role: member.id === ownerId ? 'Owner' as const : 'Member' as const,
    })), [members, ownerId])

    const table = useTable(
        {
            features,
            columns,
            data,
            initialState: { sorting: [{ id: 'member', desc: false }] },
        },
        state => ({ sorting: state.sorting }),
    )

    return (
        <Table.Root>
            <Table.Caption className='sr-only'>Workspace members</Table.Caption>
            <Table.Header className='[&_tr]:border-0'>
                {table.getHeaderGroups().map(group => (
                    <Table.Row key={group.id} className='border-0 hover:bg-transparent'>
                        {group.headers.map(header => (
                            <Table.Head key={header.id} className={HEAD_WIDTH[header.column.id]}>
                                <button
                                    className='flex items-center gap-1 hover:text-foreground transition-colors'
                                    onClick={header.column.getToggleSortingHandler()}
                                >
                                    <table.FlexRender header={header} />
                                    <SortIcon direction={header.column.getIsSorted()} />
                                </button>
                            </Table.Head>
                        ))}
                    </Table.Row>
                ))}
            </Table.Header>
            <Table.Body>
                {table.getRowModel().rows.map(row => (
                    <Table.Row key={row.id} className='border-0 hover:bg-transparent'>
                        {row.getAllCells().map(cell => (
                            <Table.Cell key={cell.id} className='px-4 py-4'>
                                <table.FlexRender cell={cell} />
                            </Table.Cell>
                        ))}
                    </Table.Row>
                ))}
            </Table.Body>
        </Table.Root>
    )
}
