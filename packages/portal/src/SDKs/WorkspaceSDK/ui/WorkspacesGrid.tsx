import { QuerySDK } from '@pretzel-graph/standard-ui/SDKs/QuerySDK/sdk'
import { useState, type ReactNode } from 'react'
import { Badge, Button, DropdownMenu, SearchInput, Spinner } from '@pretzel-graph/standard-ui/foundations'
import { Card } from '@pretzel-graph/standard-ui/foundations/card'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import type { BadgeProps } from '@pretzel-graph/standard-ui/foundations'
import type { Workspace } from '@pretzel-cloud/shared/domain'
import { NotificationSDK } from '@pretzel-graph/standard-ui/SDKs/NotificationSDK'
import { WorkspaceSDK } from '../sdk'
import { DEFAULT_SORT } from '../selectors'
import { openCreateWorkspaceDialog } from '@/SDKs/WorkspaceSDK/ui/create-dialogs'
import { openWorkspaceConfigurationDialog } from '@/SDKs/WorkspaceSDK/ui/WorkspaceConfiguration'
import { ServerIllustration } from '@pretzel-graph/standard-ui/icons/illustrations'

const STALE_TIME = 30_000

/** Shared with the route loader, so both name the same cache entry. */
export const workspacesQuery = {
    queryKey: ['workspaces'] as const,
    queryFn: () => WorkspaceSDK.actions.list(),
    staleTime: STALE_TIME,
}

// Keyed by the status enum, so adding a state to it fails to compile until it
// is given an appearance here.
const STATUS: Record<Workspace.Status, { label: string; variant: BadgeProps['variant']; icon: ReactNode }> = {
    provisioning: { label: 'Provisioning', variant: 'secondary', icon: <Spinner className="size-2.5" /> },
    ready: { label: 'Ready', variant: 'success', icon: <SystemIcons.Check /> },
    suspended: { label: 'Suspended', variant: 'outline', icon: <SystemIcons.Moon /> },
    failed: { label: 'Failed', variant: 'destructive', icon: <SystemIcons.AlertTriangle /> },
}

const StatusBadge = ({ status }: { status: Workspace.Status }) => {
    const { label, variant, icon } = STATUS[status]

    return (
        <Badge variant={variant} size="sm">
            {icon}
            {label}
        </Badge>
    )
}

/**
 * Silent success is the wrong default for a copy: the whole point is pasting it
 * somewhere else, and the clipboard rejects outright without a secure context.
 */
const copyWorkspaceId = async (id: Workspace.Id) => {
    try {
        await navigator.clipboard.writeText(id)

        NotificationSDK.toast.success('Workspace ID copied')
    }
    catch {
        NotificationSDK.toast.error('Could not reach the clipboard')
    }
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

    const { error, isPending } = QuerySDK.useQuery<unknown, Error>(
        workspacesQuery.queryKey,
        workspacesQuery.queryFn,
        { staleTime: STALE_TIME },
    )

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
                    <Card.Root
                        className='w-[340px] cursor-pointer transition-shadow'
                        key={workspace.id}
                        // A full navigation, not a route change: the editor is a
                        // separate origin with its own lifetime.
                        onClick={() => { window.location.href = workspace.appUrl }}
                    >
                        <Card.Header>
                            <div className='flex flex-row gap-2'>
                                <ServerIllustration className='h-6'/>
                                <Card.Title className='text-sm'>{workspace.displayName}</Card.Title>
                            </div>

                            <Card.Action onClick={(event) => event.stopPropagation()}>
                                <DropdownMenu.Root>
                                    <DropdownMenu.Trigger asChild>
                                        <Button size="icon-xs" variant="ghost">
                                            <SystemIcons.Ellipsis />
                                        </Button>
                                    </DropdownMenu.Trigger>
                                    <DropdownMenu.Content align='start' side="right">
                                        <DropdownMenu.Item
                                            className='gap-2 text-xs'
                                            onClick={() => copyWorkspaceId(workspace.id)}
                                        >
                                            <SystemIcons.Copy />
                                            Copy Workspace ID
                                        </DropdownMenu.Item>
                                        <DropdownMenu.Item
                                            className='gap-2 text-xs'
                                            onClick={() => openWorkspaceConfigurationDialog(workspace.id)}
                                        >
                                            <SystemIcons.Settings />
                                            Open Configuration
                                        </DropdownMenu.Item>
                                    </DropdownMenu.Content>
                                </DropdownMenu.Root>
                            </Card.Action>
                        </Card.Header>
                        <Card.Content className='w-full flex'>
                            <StatusBadge status={workspace.status} />

                        </Card.Content>
                    </Card.Root>
                ))}
            </div>
        </>
    )
}
