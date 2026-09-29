import { useState } from 'react'
import { Admin } from '@pretzel-cloud/shared/domain'
import { Button, DropdownMenu, SearchInput } from '@pretzel-graph/standard-ui/foundations'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import { NotificationSDK } from '@pretzel-graph/standard-ui/SDKs/NotificationSDK'
import { getMessageFromError } from '../../api'
import { AdminSDK } from '../sdk'
import { TEMPLATE_CATEGORIES, type TemplateCategoryId } from '@pretzel-graph/shared/constants/templateCategories'

const PAGE_SIZE = 20

/** Every listed workflow. The query owns the request; the store owns the data. */
export const AdminListings = () => {
    const [listingsById, [query]] = AdminSDK.useWith(
        (s) => s.listings,
        (q) => [q.listingsList],
    )

    const { error, isPending, isFetching, refetch } = query

    const listings = Object.values(listingsById)

    const [search, setSearch] = useState('')

    const [page, setPage] = useState(0)

    const term = search.trim().toLowerCase()

    const categoryLabelsOf = (listing: Admin.ListingSummary) => (listing.template?.categoryIds ?? [])
        .map((categoryId) => TEMPLATE_CATEGORIES[categoryId as TemplateCategoryId]?.label ?? categoryId)

    const filtered = listings.filter((listing) => [
        listing.name, listing.id, listing.workspace.displayName, listing.workspace.id, listing.blueprintId ?? '', ...categoryLabelsOf(listing),
    ].some((value) => value.toLowerCase().includes(term)))

    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))

    const currentPage = Math.min(page, pages - 1)

    const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)

    const onSearch = (value: string) => {
        setSearch(value)

        setPage(0)
    }

    const copyListingId = async (listing: Admin.ListingSummary) => {
        await navigator.clipboard.writeText(listing.id)

        NotificationSDK.toast.success('Listing ID copied')
    }

    return (
        <section className="space-y-5 px-3 pt-4">
            <div className="flex flex-wrap items-center gap-3">
                <SearchInput
                    wrapperClassName="w-full max-w-md"
                    size="sm"
                    placeholder="Search listings…"
                    aria-label="Search listings"
                    onSearch={onSearch}
                />
                {!isPending && <span className="text-xs text-muted-foreground">{filtered.length} of {listings.length} listings</span>}
                <Button variant="input" size="sm" className="ml-auto" onClick={() => void refetch()} disabled={isFetching}>
                    <SystemIcons.RefreshCcw size={14} className={isFetching ? 'animate-spin' : ''} />
                    Refresh
                </Button>
            </div>

            {error && (
                <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                    {getMessageFromError(error, 'Could not load listings. Use Refresh to try again.')}
                </div>
            )}

            {isPending && listings.length === 0 ? (
                <p role="status" className="py-12 text-center text-sm text-muted-foreground">Loading listings…</p>
            ) : filtered.length === 0 ? (
                !error && (
                    <div className="p-12 text-center text-sm text-muted-foreground">
                        {listings.length === 0 ? 'No listings yet.' : 'No listings match your search.'}
                    </div>
                )
            ) : (
                <>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <caption className="sr-only">All listings</caption>
                            <thead className="text-xs text-muted-foreground">
                                <tr>{['Workflow', 'Workspace', 'Version', 'Offered as', 'Published', 'Actions'].map((label) => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr>
                            </thead>
                            <tbody>
                                {visible.map((listing) => (
                                    <tr key={listing.id}>
                                        <td className="px-4 py-4">
                                            <p className="font-medium break-words">{listing.name}</p>
                                            {listing.description && <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{listing.description}</p>}
                                        </td>
                                        <td className="px-4 py-4 break-words">{listing.workspace.displayName}</td>
                                        <td className="px-4 py-4 whitespace-nowrap">
                                            <p>v{listing.version}</p>
                                            <p className="mt-1 text-xs text-muted-foreground">{listing.release}</p>
                                        </td>
                                        <td className="px-4 py-4">
                                            <div className="flex flex-wrap gap-1">
                                                {listing.template && <TemplateChip categoryLabels={categoryLabelsOf(listing)} />}
                                                {listing.blueprintId && <span className="inline-block rounded-full px-2 py-1 text-xs whitespace-nowrap bg-muted text-muted-foreground">Shelf · {listing.blueprintId}</span>}
                                            </div>
                                        </td>
                                        <td className="px-4 py-4 whitespace-nowrap text-xs text-muted-foreground">{listing.publishedAt.toLocaleDateString()}</td>
                                        <td className="px-4 py-4">
                                            <DropdownMenu.Root>
                                                <DropdownMenu.Trigger asChild>
                                                    <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${listing.name}`}>
                                                        <SystemIcons.Ellipsis size={16} />
                                                    </Button>
                                                </DropdownMenu.Trigger>
                                                <DropdownMenu.Content align="end">
                                                    <DropdownMenu.Item onSelect={() => void copyListingId(listing)}>
                                                        <SystemIcons.Copy size={14} /> Copy listing ID
                                                    </DropdownMenu.Item>
                                                    <DropdownMenu.Separator />
                                                    <DropdownMenu.Item onSelect={() => AdminSDK.dialogs.openSetTemplate(listing)}>
                                                        <SystemIcons.SwatchBook size={14} /> {listing.template ? 'Edit template…' : 'Mark as template…'}
                                                    </DropdownMenu.Item>
                                                    {listing.template && (
                                                        <DropdownMenu.Item onSelect={() => void AdminSDK.actions.listings.removeTemplate(listing.id)}>
                                                            <SystemIcons.X size={14} /> Remove from templates
                                                        </DropdownMenu.Item>
                                                    )}
                                                    <DropdownMenu.Separator />
                                                    <DropdownMenu.Item onSelect={() => AdminSDK.dialogs.openSetShelfBlueprint(listing)}>
                                                        <SystemIcons.Toolbox size={14} /> {listing.blueprintId ? 'Edit shelf blueprint…' : 'Add to extended shelf…'}
                                                    </DropdownMenu.Item>
                                                    {listing.blueprintId && (
                                                        <DropdownMenu.Item onSelect={() => void AdminSDK.actions.listings.removeFromShelf(listing.id)}>
                                                            <SystemIcons.X size={14} /> Remove from extended shelf
                                                        </DropdownMenu.Item>
                                                    )}
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

const TemplateChip = ({ categoryLabels }: { categoryLabels: string[] }) => {
    const suffix = categoryLabels.length > 0 ? ` · ${categoryLabels.join(', ')}` : ''

    return (
        <span className="inline-block rounded-full px-2 py-1 text-xs whitespace-nowrap bg-muted text-muted-foreground">
            Template{suffix}
        </span>
    )
}
