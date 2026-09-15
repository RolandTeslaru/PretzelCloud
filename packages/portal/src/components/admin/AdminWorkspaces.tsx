import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Admin } from '@pretzel-cloud/shared/domain'
import { Button, DropdownMenu, Input } from '@pretzel-graph/standard-ui/foundations'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import { DialogSDK } from '@pretzel-graph/standard-ui/SDKs/DialogSDK'
import { AuthSDK } from '@/SDKs/AuthSDK'
import { api, getMessageFromError } from '@/SDKs/api'
import { DeleteWorkspaceDialog } from './DeleteWorkspaceDialog'

const PAGE_SIZE = 20

export function AdminWorkspaces() {
    const userId = AuthSDK.useStore((s) => s.user?.id)
    const isAdmin = AuthSDK.useStore((s) => s.user?.isAdmin ?? false)
    const [search, setSearch] = useState('')
    const [page, setPage] = useState(0)
    const query = useQuery({
        queryKey: ['admin', 'workspaces', userId],
        queryFn: () => Admin.API.list(api),
        enabled: isAdmin,
        gcTime: 0,
        retry: false,
    })

    if (!isAdmin) return null

    const summaries = query.data?.workspaces ?? []
    const term = search.trim().toLowerCase()
    const filtered = summaries.filter(({ workspace, owner }) => [
        workspace.displayName, workspace.id, owner.email,
        owner.username, owner.displayName, owner.id,
    ].some((value) => value.toLowerCase().includes(term)))
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
    const currentPage = Math.min(page, pages - 1)
    const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)

    const openDelete = (summary: Admin.WorkspaceSummary) => {
        DialogSDK.actions.push(`admin-delete-${summary.workspace.id}`, (props) => (
            <DeleteWorkspaceDialog {...props} summary={summary} />
        ))
    }

    return (
        <section className="space-y-5 px-3 pt-4">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h2 className="text-lg font-semibold">All workspaces</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Find a workspace by name, owner, or ID and manage its deletion.</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>
                    <SystemIcons.RefreshCcw size={14} className={query.isFetching ? 'animate-spin' : ''} />
                    Refresh
                </Button>
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <Input
                    className="max-w-md"
                    placeholder="Search workspaces or owners…"
                    aria-label="Search workspaces or owners"
                    value={search}
                    onChange={(event) => { setSearch(event.target.value); setPage(0) }}
                />
                {query.data && <span className="text-xs text-muted-foreground">{filtered.length} of {summaries.length} workspaces</span>}
            </div>

            {query.isError && (
                <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                    {getMessageFromError(query.error, 'Could not load workspaces. Use Refresh to try again.')}
                </div>
            )}

            {query.isPending ? (
                <p role="status" className="py-12 text-center text-sm text-muted-foreground">Loading workspaces…</p>
            ) : query.data && filtered.length === 0 ? (
                <div className="p-12 text-center text-sm text-muted-foreground">
                    {summaries.length === 0 ? 'No workspaces yet.' : 'No workspaces match your search.'}
                </div>
            ) : query.data && (
                <>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <caption className="sr-only">All users’ workspaces</caption>
                            <thead className="text-xs text-muted-foreground">
                                <tr>{['Workspace', 'Owner', 'Plan', 'Status', 'Created', 'Actions'].map((label) => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr>
                            </thead>
                            <tbody>
                                {visible.map(({ workspace, owner }) => (
                                    <tr key={workspace.id}>
                                        <td className="px-4 py-4">
                                            <p className="font-medium break-words">{workspace.displayName}</p>
                                            <p className="mt-1 text-[10px] font-mono text-muted-foreground">{workspace.id}</p>
                                        </td>
                                        <td className="px-4 py-4">
                                            <p className="break-all">{owner.email}</p>
                                            <p className="mt-1 text-xs text-muted-foreground">@{owner.username}</p>
                                        </td>
                                        <td className="px-4 py-4 whitespace-nowrap">{workspace.plan.displayName}</td>
                                        <td className="px-4 py-4">
                                            <span title={workspace.disabledReason ?? undefined} className={`inline-block rounded-full px-2 py-1 text-xs whitespace-nowrap ${workspace.lifecycleState === 'disabled' || workspace.lifecycleState === 'provisioning_failed' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}>
                                                {workspace.lifecycleState.replaceAll('_', ' ')}
                                            </span>
                                        </td>
                                        <td className="px-4 py-4 whitespace-nowrap text-xs text-muted-foreground">{workspace.createdAt.toLocaleDateString()}</td>
                                        <td className="px-4 py-4">
                                            <DropdownMenu.Root>
                                                <DropdownMenu.Trigger asChild>
                                                    <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${workspace.displayName} owned by ${owner.email}`}>
                                                        <SystemIcons.Ellipsis size={16} />
                                                    </Button>
                                                </DropdownMenu.Trigger>
                                                <DropdownMenu.Content align="end">
                                                    <DropdownMenu.Item variant="destructive" onSelect={() => openDelete({ workspace, owner })}>
                                                        <SystemIcons.Trash2 size={14} /> Delete workspace
                                                    </DropdownMenu.Item>
                                                </DropdownMenu.Content>
                                            </DropdownMenu.Root>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {pages > 1 && <div className="flex items-center justify-end gap-3 text-xs text-muted-foreground">
                        <Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button>
                        <span>Page {currentPage + 1} of {pages}</span>
                        <Button variant="outline" size="sm" disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}>Next</Button>
                    </div>}
                </>
            )}
        </section>
    )
}
