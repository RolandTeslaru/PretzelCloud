import { useState } from 'react'
import { Admin, Template } from '@pretzel-cloud/shared/domain'
import { AlertDialog, Checkbox, Input } from '@pretzel-graph/standard-ui/foundations'
import { DialogSDK } from '@pretzel-graph/standard-ui/SDKs/DialogSDK'
import { TEMPLATE_CATEGORIES } from '@pretzel-graph/shared/constants/templateCategories'

type Props = Omit<DialogSDK.AlertTemplateProps, 'onApprove'> & {
    listing: Admin.ListingSummary
    onConfirm: (template: Template.API.Set.Request) => void
}

export const SetTemplateDialog = ({ listing, onConfirm, ...props }: Props) => {
    const [categoryIds, setCategoryIds] = useState<Template.CategoryId[]>(listing.template?.categoryIds ?? [])

    const [sortOrder, setSortOrder] = useState(String(listing.template?.sortOrder ?? 0))

    const categories = Object.values(TEMPLATE_CATEGORIES)

    const parsed = Template.API.Set.Request.safeParse({ categoryIds, sortOrder: Number(sortOrder) })

    const toggleCategory = (categoryId: Template.CategoryId, checked: boolean) => {
        setCategoryIds((current) => checked
            ? [...current, categoryId]
            : current.filter((id) => id !== categoryId))
    }

    return (
        <DialogSDK.AlertTemplate
            {...props}
            type='default'
            approveLabel={listing.template ? 'Save template' : 'Mark as template'}
            approveDisabled={!parsed.success}
            onApprove={() => parsed.success && onConfirm(parsed.data)}
        >
            <AlertDialog.Title>{listing.template ? 'Edit' : 'Mark'} {listing.name} as a template</AlertDialog.Title>

            <AlertDialog.Description>
                Every workspace on release {listing.release} or later can start a new workflow from a copy of it.
            </AlertDialog.Description>

            <div className='mt-4 text-sm space-y-1 break-all'>
                <p><span className='text-muted-foreground'>Workspace:</span> {listing.workspace.displayName}</p>
                <p className='font-mono text-xs text-muted-foreground'>{listing.id}</p>
            </div>

            <div className='flex flex-col gap-2 pt-4'>
                <p className='text-xs text-muted-foreground'>Categories</p>
                <div className='grid grid-cols-2 gap-x-4 gap-y-2'>
                    {categories.map((category) => (
                        <label key={category.id} className='flex items-center gap-2 text-sm cursor-pointer'>
                            <Checkbox
                                checked={categoryIds.includes(category.id)}
                                onCheckedChange={(checked) => toggleCategory(category.id, checked === true)}
                            />
                            <span className='truncate'>
                                {category.section && <span className='text-muted-foreground'>{category.section} · </span>}
                                {category.label}
                            </span>
                        </label>
                    ))}
                </div>
            </div>

            <div className='flex flex-col gap-2 pt-4'>
                <p className='text-xs text-muted-foreground'>Sort order, lowest first</p>
                <Input
                    type='number'
                    step={1}
                    value={sortOrder}
                    onChange={(event) => setSortOrder(event.target.value)}
                    aria-label='Template sort order'
                    size='sm'
                />
            </div>
        </DialogSDK.AlertTemplate>
    )
}
