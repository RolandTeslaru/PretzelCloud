import { QuerySDK } from '@pretzel-graph/standard-ui/SDKs/QuerySDK/sdk'
import { useEffect, useState } from 'react'
import { Button, DropdownMenu, SearchInput } from '@pretzel-graph/standard-ui/foundations'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import { Workspace } from '@pretzel-cloud/shared/domain'
import { RealtimeSDK } from '@/SDKs/RealtimeSDK'
import { WorkspaceSDK } from '../../sdk'
import { DEFAULT_SORT } from '../../selectors'
import { openCreateWorkspaceDialog } from '@/SDKs/WorkspaceSDK/ui/create-dialogs'
import { WorkspaceCard } from './card'

const STALE_TIME = 30_000

/** Shared with the route loader, so both name the same cache entry. */
export const workspacesQuery = {
    queryKey: ['workspaces'] as const,
    queryFn: () => WorkspaceSDK.actions.list(),
    staleTime: STALE_TIME,
}


const SORT_FIELDS: { field: WorkspaceSDK.SortField; label: string }[] = [
    { field: 'name',    label: 'By name' },
    { field: 'created', label: 'By creation date' },
]

const DIRECTIONS: { direction: WorkspaceSDK.SortDirection; label: string }[] = [
    { direction: 'asc',  label: 'Ascending' },
    { direction: 'desc', label: 'Descending' },
]

const SortMenu = ({ sort, onChange }: {
    sort: WorkspaceSDK.Sort
    onChange: (sort: WorkspaceSDK.Sort) => void
}) => (
    <DropdownMenu.Root>
        {/* asChild, or Radix renders its own button around this one. */}
        <DropdownMenu.Trigger asChild>
            <Button variant="input" size="sm">
                {sort.direction === 'asc'
                    ? <SystemIcons.ArrowUpNarrowWide />
                    : <SystemIcons.ArrowDownWideNarrow />}
                {SORT_FIELDS.find((f) => f.field === sort.field)?.label}
            </Button>
        </DropdownMenu.Trigger>

        {/* Sub menus have to live inside Content — Radix throws otherwise. */}
        <DropdownMenu.Content align="start">
            {SORT_FIELDS.map(({ field, label }) => (
                <DropdownMenu.Sub key={field}>
                    <DropdownMenu.SubTrigger>{label}</DropdownMenu.SubTrigger>

                    <DropdownMenu.SubContent>
                        {/* Only the active field shows a mark, so the menu says
                            what is in force rather than only what is available. */}
                        <DropdownMenu.RadioGroup
                            value={sort.field === field ? sort.direction : ''}
                            onValueChange={(direction) =>
                                onChange({ field, direction: direction as WorkspaceSDK.SortDirection })}
                        >
                            {DIRECTIONS.map(({ direction, label: dir }) => (
                                <DropdownMenu.RadioItem key={direction} value={direction}>
                                    {dir}
                                </DropdownMenu.RadioItem>
                            ))}
                        </DropdownMenu.RadioGroup>
                    </DropdownMenu.SubContent>
                </DropdownMenu.Sub>
            ))}
        </DropdownMenu.Content>
    </DropdownMenu.Root>
)


/**
 * Every workspace the caller can reach. The query owns the request; the store
 * owns the data, so a create or destroy elsewhere shows up here without a
 * refetch.
 */
export const WorkspacesGrid = () => {

    // The list seeds the store once; the socket keeps it live from there.
    const { error, isPending } = QuerySDK.useQuery<unknown, Error>(
        workspacesQuery.queryKey,
        workspacesQuery.queryFn,
        { staleTime: STALE_TIME },
    )

    // Shallow-compared by the store, so this is stable until a card is added or
    // removed — which is exactly when the subscriptions should be rebuilt.
    const ids = WorkspaceSDK.useStore((s) => Object.keys(s.workspaces) as Workspace.Id[])

    useEffect(() => {
        const stops = ids.map((id) =>
            RealtimeSDK.subscribeToChannel<Workspace.Event.Any>(
                Workspace.Event.getChannel(id),
                (event) => WorkspaceSDK.actions.applyEvent(event),
            ))

        return () => stops.forEach((stop) => stop())
    }, [ids])

    // Filtering is local to what the store already holds, so typing never
    // reaches the control plane.
    const [query, setQuery] = useState('')

    const [sort, setSort] = useState<WorkspaceSDK.Sort>(DEFAULT_SORT)

    const total      = WorkspaceSDK.useStore((s) => s.selectors.count(s))
    const workspaces = WorkspaceSDK.useStore((s) => s.selectors.matching(s, query, sort))


    return (
        <>
            {/* Outside the empty branches: creating the first workspace and
                clearing a search both have to stay reachable. */}
            <div className='flex flex-row justify-end gap-2 w-full'>
                <SearchInput className='rounded-full! w-[200px] text-xs!' size="sm" onSearch={setQuery} placeholder="Search for a workspace" />
                <SortMenu sort={sort} onChange={setSort} />
                <Button size="sm" onClick={() => openCreateWorkspaceDialog()}>
                    <SystemIcons.Plus /> New workspace
                </Button>
            </div>


            <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(20rem,1fr))] gap-4">
                {workspaces.length === 0 && (
                    <Button className="w-[340px] h-[140px] bg-transparent! border-1 border-border shadow-none! hover:bg-white/10 cursor-pointer"
                        onClick={() => openCreateWorkspaceDialog()}
                    >

                        <SystemIcons.Plus className='text-border! size-10! m-auto'/>
                    </Button>

                )}
                {workspaces.map((workspace) => (
                    <WorkspaceCard key={workspace.id} workspace={workspace} />
                ))}
            </div>
        </>
    )
}
