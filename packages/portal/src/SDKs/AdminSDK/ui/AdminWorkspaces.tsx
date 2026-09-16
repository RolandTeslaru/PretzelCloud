import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Button, SearchInput } from '@pretzel-graph/standard-ui/foundations'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import { StatusBadge } from '../../WorkspaceSDK/ui/StatusBadge'
import { getMessageFromError } from '../../api'
import { AdminSDK } from '../sdk'
import { AdminWorkspaceActions } from './AdminWorkspaceActions'

const PAGE_SIZE = 20

/** Every workspace across every owner. The query owns the request; the store owns the data. */
export const AdminWorkspaces = () => {
    const { error, isPending, isFetching, refetch } = AdminSDK.useWorkspacesQuery()

    const workspacesById = AdminSDK.useStore((s) => s.workspaces)

    const summaries = Object.values(workspacesById)

    const navigate = useNavigate()

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

    return (
        <section className="space-y-5 px-3 pt-4">
            <div className="flex flex-wrap items-center gap-3">
                <SearchInput
                    wrapperClassName="w-full max-w-md"
                    size="sm"
                    placeholder="Search workspaces or owners…"
                    aria-label="Search workspaces or owners"
                    onSearch={onSearch}
                />
                {!isPending && <span className="text-xs text-muted-foreground">{filtered.length} of {summaries.length} workspaces</span>}
                <Button variant="input" size="sm" className="ml-auto" onClick={() => void refetch()} disabled={isFetching}>
                    <SystemIcons.RefreshCcw size={14} className={isFetching ? 'animate-spin' : ''} />
                    Refresh
                </Button>
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
                                        <tr
                                            key={workspace.id}
                                            className="cursor-pointer"
                                            tabIndex={0}
                                            onClick={() => void navigate({ to: '/admin/workspaces/$workspaceId', params: { workspaceId: workspace.id } })}
                                            onKeyDown={(event) => {
                                                if (event.key !== 'Enter' && event.key !== ' ') return

                                                event.preventDefault()

                                                void navigate({ to: '/admin/workspaces/$workspaceId', params: { workspaceId: workspace.id } })
                                            }}
                                        >
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
                                                <span title={workspace.disabledReason ?? undefined}>
                                                    <StatusBadge workspace={workspace} />
                                                </span>
                                            </td>
                                            <td className="px-4 py-4 whitespace-nowrap text-xs text-muted-foreground">{workspace.createdAt.toLocaleDateString()}</td>
                                            <td className="px-4 py-4" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                                                <AdminWorkspaceActions summary={summary} />
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
