import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, Dialog, Form, Input, Spinner } from '@pretzel-graph/standard-ui/foundations'
import { DialogSDK } from '@pretzel-graph/standard-ui/SDKs/DialogSDK'
import { NotificationSDK } from '@pretzel-graph/standard-ui/SDKs/NotificationSDK'
import { ServerIllustration } from '@pretzel-graph/standard-ui/icons/illustrations'
import { Workspace } from '@pretzel-cloud/shared/domain'
import { WorkspaceSDK } from '../sdk'

const DIALOG_ID = 'create-workspace'

const Schema = z.object({
    displayName: Workspace.DisplayName,
})
type Values = z.infer<typeof Schema>

export function openCreateWorkspaceDialog() {
    DialogSDK.actions.push(DIALOG_ID, (props) => (
        <DialogSDK.SplitTemplate
            {...props}
            className='h-[400px]'
            sidebarClassName='w-[400px]'
            sidebarRenderer={() => (
                <>
                    <div className='flex flex-row gap-2'>
                        <ServerIllustration className='size-10 shrink-0' />
                        <Dialog.Title className='text-sm font-semibold my-auto'>Workspace Builder</Dialog.Title>
                    </div>
                    <Dialog.Description className='text-xs text-muted-foreground pt-1'>
                        Every workspace is its own isolated deployment with a private database and private compute.
                    </Dialog.Description>
                </>
            )}
        >
            <CreateWorkspaceContent dialogId={DIALOG_ID} />
        </DialogSDK.SplitTemplate>
    ))
}

function CreateWorkspaceContent({ dialogId }: { dialogId: string }) {
    const form = useForm<Values>({
        resolver: zodResolver(Schema),
        defaultValues: { displayName: '' },
    })

    const onSubmit = async (values: Values) => {
        try {
            await WorkspaceSDK.actions.create(values)

            DialogSDK.actions.pop(dialogId)
        }
        catch (error) {
            const replied = (error as { response?: { data?: { message?: string } } })?.response?.data?.message

            NotificationSDK.toast.error(replied ?? 'Could not create the workspace')
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
