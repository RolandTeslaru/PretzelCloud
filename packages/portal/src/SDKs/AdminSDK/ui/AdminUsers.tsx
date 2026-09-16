import { useState } from 'react'
import { Admin } from '@pretzel-cloud/shared/domain'
import { Button, DropdownMenu, SearchInput } from '@pretzel-graph/standard-ui/foundations'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import { NotificationSDK } from '@pretzel-graph/standard-ui/SDKs/NotificationSDK'
import { AuthSDK } from '../../AuthSDK'
import { getMessageFromError } from '../../api'
import { AdminSDK } from '../sdk'

const PAGE_SIZE = 20

/** Every account. The query owns the request; the store owns the data. */
export const AdminUsers = () => {
    const { error, isPending, isFetching, refetch } = AdminSDK.useUsersQuery()

    const usersById = AdminSDK.useStore((s) => s.users)

    const users = Object.values(usersById)

    const currentUserId = AuthSDK.useStore((s) => s.user?.id)

    const [search, setSearch] = useState('')

    const [page, setPage] = useState(0)

    const term = search.trim().toLowerCase()

    const filtered = users.filter((user) => [
        user.email, user.username, user.displayName, user.id,
    ].some((value) => value.toLowerCase().includes(term)))

    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))

    const currentPage = Math.min(page, pages - 1)

    const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)

    const onSearch = (value: string) => {
        setSearch(value)

        setPage(0)
    }

    const copyUserId = async (user: Admin.UserSummary) => {
        await navigator.clipboard.writeText(user.id)

        NotificationSDK.toast.success('User ID copied')
    }

    return (
        <section className="space-y-5 px-3 pt-4">
            <div className="flex flex-wrap items-center gap-3">
                <SearchInput
                    wrapperClassName="w-full max-w-md"
                    size="sm"
                    placeholder="Search users…"
                    aria-label="Search users"
                    onSearch={onSearch}
                />
                {!isPending && <span className="text-xs text-muted-foreground">{filtered.length} of {users.length} users</span>}
                <Button variant="input" size="sm" className="ml-auto" onClick={() => void refetch()} disabled={isFetching}>
                    <SystemIcons.RefreshCcw size={14} className={isFetching ? 'animate-spin' : ''} />
                    Refresh
                </Button>
            </div>

            {error && (
                <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                    {getMessageFromError(error, 'Could not load users. Use Refresh to try again.')}
                </div>
            )}

            {isPending && users.length === 0 ? (
                <p role="status" className="py-12 text-center text-sm text-muted-foreground">Loading users…</p>
            ) : filtered.length === 0 ? (
                !error && (
                    <div className="p-12 text-center text-sm text-muted-foreground">
                        {users.length === 0 ? 'No users yet.' : 'No users match your search.'}
                    </div>
                )
            ) : (
                <>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <caption className="sr-only">All users</caption>
                            <thead className="text-xs text-muted-foreground">
                                <tr>{['User', 'Email', 'Workspaces', 'Role', 'Joined', 'Actions'].map((label) => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr>
                            </thead>
                            <tbody>
                                {visible.map((user) => (
                                    <tr key={user.id}>
                                        <td className="px-4 py-4">
                                            <p className="font-medium break-words">{user.displayName}</p>
                                            <p className="mt-1 text-xs text-muted-foreground">@{user.username}</p>
                                        </td>
                                        <td className="px-4 py-4 break-all">{user.email}</td>
                                        <td className="px-4 py-4 whitespace-nowrap">{user.ownedWorkspaceCount}</td>
                                        <td className="px-4 py-4">
                                            {user.isAdmin && <span className="inline-block rounded-full px-2 py-1 text-xs whitespace-nowrap bg-muted text-muted-foreground">Admin</span>}
                                        </td>
                                        <td className="px-4 py-4 whitespace-nowrap text-xs text-muted-foreground">{user.createdAt.toLocaleDateString()}</td>
                                        <td className="px-4 py-4">
                                            <DropdownMenu.Root>
                                                <DropdownMenu.Trigger asChild>
                                                    <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${user.email}`}>
                                                        <SystemIcons.Ellipsis size={16} />
                                                    </Button>
                                                </DropdownMenu.Trigger>
                                                <DropdownMenu.Content align="end">
                                                    <DropdownMenu.Item onSelect={() => void copyUserId(user)}>
                                                        <SystemIcons.Copy size={14} /> Copy user ID
                                                    </DropdownMenu.Item>
                                                    <DropdownMenu.Item variant="destructive" disabled={user.id === currentUserId} onSelect={() => AdminSDK.openDeleteUserDialog(user)}>
                                                        <SystemIcons.Trash2 size={14} /> Delete user
                                                    </DropdownMenu.Item>
                                                </DropdownMenu.Content>
                                            </DropdownMenu.Root>
                                        </td>
                                    </tr>
                                ))}
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
