import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, Form, Input, Select, Spinner } from '@pretzel-graph/standard-ui/foundations'
import { DialogSDK } from '@pretzel-graph/standard-ui/SDKs/DialogSDK'
import { NotificationSDK } from '@pretzel-graph/standard-ui/SDKs/NotificationSDK'
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain'
import { getMessageFromError } from '@/SDKs/api'
import { WorkspaceSDK } from '../sdk'

const Schema = z.object({
    displayName: Workspace.DisplayName,
    region:      Fleet.Region.Schema,
})
type Values = z.infer<typeof Schema>

// Timezone areas closer to Frankfurt than to Virginia.
const EUROPEAN_AREAS = ['Europe/', 'Africa/']

/** A starting region from the browser's timezone, which needs no location permission. */
function guessRegion(): Fleet.Region.Schema {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''

    for (const area of EUROPEAN_AREAS) {
        if (timeZone.startsWith(area))
            return 'eu-central-1'
    }

    return 'us-east-1'
}

export function CreateWorkspaceDialog({ dialogId }: { dialogId: string }) {
    const form = useForm<Values>({
        resolver: zodResolver(Schema),
        defaultValues: { displayName: '', region: guessRegion() },
    })

    const onSubmit = async (values: Values) => {
        try {
            await WorkspaceSDK.actions.create(values)

            DialogSDK.actions.pop(dialogId)
        }
        catch (error) {
            NotificationSDK.toast.error(getMessageFromError(error, 'Could not create the workspace'))
        }
    }

    const busy = form.formState.isSubmitting

    return (
        <Form.Root {...form}>
            <form
                onSubmit={form.handleSubmit(onSubmit)}
                className='flex flex-col gap-3 h-full pt-3'
                autoComplete='off'
            >
                <p className='text-sm font-medium'>
                    Configure the Workspace
                </p>

                <Form.Field control={form.control} name="displayName" render={({ field }) => (
                    <Form.Item>
                        <Form.Label>Name</Form.Label>
                        <Form.Control>
                            <Input
                                {...field}
                                autoFocus
                                autoComplete='off'
                            />
                        </Form.Control>
                        <Form.Message />
                    </Form.Item>
                )} />

                <Form.Field control={form.control} name="region" render={({ field }) => (
                    <Form.Item>
                        <Form.Label>Region</Form.Label>
                        <Select.Root value={field.value} onValueChange={field.onChange}>
                            <Form.Control>
                                <Select.Trigger>
                                    <Select.Value />
                                </Select.Trigger>
                            </Form.Control>
                            <Select.Content>
                                {Fleet.Region.all().map((region) => (
                                    <Select.Item key={region} value={region}>{Fleet.Region.getDisplayName(region)}</Select.Item>
                                ))}
                            </Select.Content>
                        </Select.Root>
                        <Form.Message />
                    </Form.Item>
                )} />

                <div className='flex flex-row justify-end mt-auto'>
                    <Button type='submit' size='sm' disabled={busy} className='rounded-full'>
                        {busy && <Spinner className='mr-2 h-4 w-4' />}
                        Save
                    </Button>
                </div>
            </form>
        </Form.Root>
    )
}
