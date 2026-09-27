import { useState } from 'react'
import { Button, DropdownMenu, Frame, SearchInput, Skeleton } from '@pretzel-graph/standard-ui/foundations'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import { WorkspaceSDK } from '../../sdk'
import { DEFAULT_SORT } from '../../selectors'
import { WorkspaceCard } from './card'

const SORT_FIELDS: { field: WorkspaceSDK.SortField; label: string }[] = [
    { field: 'name',    label: 'By name' },
    { field: 'created', label: 'By creation date' },
]

const DIRECTIONS: { direction: WorkspaceSDK.SortDirection; label: string }[] = [
    { direction: 'asc',  label: 'Ascending' },
    { direction: 'desc', label: 'Descending' },
]

const WorkspaceCardSkeleton = () => (
    <Frame.Root className='w-full overflow-hidden'>
        <Frame.Panel className='h-[100px] flex flex-col p-3 pb-2'>
            <div className='flex items-center gap-2'>
                <Skeleton className='size-6 rounded-full' />
                <Skeleton className='h-4 w-32' />
                <Skeleton className='ml-auto size-6 rounded-full' />
            </div>

            <div className='mt-auto flex gap-1.5'>
                <Skeleton className='h-5 w-20 rounded-full' />
                <Skeleton className='h-5 w-16 rounded-full' />
            </div>
        </Frame.Panel>

        <Frame.Footer className='h-[35px] px-2! py-2!'>
            <Skeleton className='h-3 w-40' />
        </Frame.Footer>
    </Frame.Root>
)

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
    const [query, setQuery] = useState('')

    const [sort, setSort] = useState<WorkspaceSDK.Sort>(DEFAULT_SORT)

    const [filteredWorkspaces, [request]] = WorkspaceSDK.useWith(
        (s) => s.selectors.matching(s, query, sort),
        (q) => [q.workspacesList],
    )

    const { isPending } = request

    let gridContent

    if (isPending && filteredWorkspaces.length === 0)
        gridContent = <WorkspaceCardSkeleton />
    
    else if (filteredWorkspaces.length === 0)
        gridContent = (
            <Button className="w-[340px] h-[140px] bg-transparent! border-1 border-border shadow-none! hover:bg-white/10 cursor-pointer"
                onClick={() => WorkspaceSDK.dialogs.openCreateWorkspace()}
            >
                <SystemIcons.Plus className='text-border! size-10! m-auto'/>
            </Button>
        )
    else
        gridContent = filteredWorkspaces.map((workspace) => (
            <WorkspaceCard key={workspace.id} workspace={workspace} />
        ))

    return (
        <>
            {/* Outside the empty branches: creating the first workspace and
                clearing a search both have to stay reachable. */}
            <div className='flex flex-row justify-end gap-2 w-full'>
                <SearchInput className='rounded-full! w-[200px] text-xs!' size="sm" onSearch={setQuery} placeholder="Search for a workspace" />
                <SortMenu sort={sort} onChange={setSort} />
                <Button size="sm" onClick={() => WorkspaceSDK.dialogs.openCreateWorkspace()}>
                    <SystemIcons.Plus /> New workspace
                </Button>
            </div>


            <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(20rem,1fr))] gap-4">
                {gridContent}
            </div>
        </>
    )
}
