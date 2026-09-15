import { useState } from 'react'
import { Admin } from '@pretzel-cloud/shared/domain'
import { Button, DropdownMenu, Input } from '@pretzel-graph/standard-ui/foundations'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import { getMessageFromError } from '../../api'
import { AdminSDK } from '../sdk'

const PAGE_SIZE = 20

/** Every workspace across every owner. The query owns the request; the store owns the data. */
export const AdminWorkspaces = () => {
    const { error, isPending, isFetching, refetch } = AdminSDK.useWorkspacesQuery()

    const summaries = AdminSDK.useStore((s) => s.workspaces)

    const [search, setSearch] = useState('')

    const [page, setPage] = useState(0)

    const term = search.trim().toLowerCase()

    const filtered = summaries.filter(({ workspace, owner }) => [
        workspace.displayName, workspace.id, owner.email,
        owner.username, owner.displayName, owner.id,
    ].some((value) => value.toLowerCase().includes(term)))

    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))

    const currentPage = Math.min(page, pages - 1)

    const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)

    const onSearch = (value: string) => {
        setSearch(value)

        setPage(0)
    }

    const openDelete = (summary: Admin.WorkspaceSummary) => AdminSDK.openDeleteWorkspaceDialog(summary)

    return (
        <section className="space-y-5 px-3 pt-4">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h2 className="text-lg font-semibold">All workspaces</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Find a workspace by name, owner, or ID and manage its deletion.</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
                    <SystemIcons.RefreshCcw size={14} className={isFetching ? 'animate-spin' : ''} />
                    Refresh
                </Button>
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <Input
                    className="max-w-md"
                    placeholder="Search workspaces or owners…"
                    aria-label="Search workspaces or owners"
                    value={search}
                    onChange={(event) => onSearch(event.target.value)}
                />
                {!isPending && <span className="text-xs text-muted-foreground">{filtered.length} of {summaries.length} workspaces</span>}
            </div>

            {error && (
                <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                    {getMessageFromError(error, 'Could not load workspaces. Use Refresh to try again.')}
                </div>
            )}

            {isPending && summaries.length === 0 ? (
                <p role="status" className="py-12 text-center text-sm text-muted-foreground">Loading workspaces…</p>
            ) : filtered.length === 0 ? (
                !error && (
                    <div className="p-12 text-center text-sm text-muted-foreground">
                        {summaries.length === 0 ? 'No workspaces yet.' : 'No workspaces match your search.'}
                    </div>
                )
            ) : (
                <>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <caption className="sr-only">All users’ workspaces</caption>
                            <thead className="text-xs text-muted-foreground">
                                <tr>{['Workspace', 'Owner', 'Plan', 'Status', 'Created', 'Actions'].map((label) => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr>
                            </thead>
                            <tbody>
                                {visible.map((summary) => {
                                    const { workspace, owner } = summary

                                    return (
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
                                                        <DropdownMenu.Item variant="destructive" onSelect={() => openDelete(summary)}>
                                                            <SystemIcons.Trash2 size={14} /> Delete workspace
                                                        </DropdownMenu.Item>
                                                    </DropdownMenu.Content>
                                                </DropdownMenu.Root>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                    {pages > 1 && (
                        <div className="flex items-center justify-end gap-3 text-xs text-muted-foreground">
                            <Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button>
                            <span>Page {currentPage + 1} of {pages}</span>
                            <Button variant="outline" size="sm" disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}>Next</Button>
                        </div>
                    )}
                </>
            )}
        </section>
    )
}
