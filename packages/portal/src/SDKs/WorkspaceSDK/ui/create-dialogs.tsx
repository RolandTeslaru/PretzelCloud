import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, Dialog, Form, Input, Spinner } from '@pretzel-graph/standard-ui/foundations'
import { DialogSDK } from '@pretzel-graph/standard-ui/SDKs/DialogSDK'
import { NotificationSDK } from '@pretzel-graph/standard-ui/SDKs/NotificationSDK'
import { Workspace } from '@pretzel-cloud/shared/domain'
import { WorkspaceSDK } from '../sdk'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'

const DIALOG_CLASSNAME = 'sm:max-w-[480px] w-full'

const DIALOG_ID = 'create-workspace'

const Schema = z.object({
    displayName: Workspace.DisplayName,
})
type Values = z.infer<typeof Schema>

export function openCreateWorkspaceDialog() {
    DialogSDK.actions.push(DIALOG_ID, (props) => (
        <DialogSDK.Template {...props} className={DIALOG_CLASSNAME}>
            <CreateWorkspaceContent dialogId={DIALOG_ID} />
        </DialogSDK.Template>
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
        <div className="flex flex-col gap-4 p-3">
            <Dialog.Header className="my-1">
                <div className='flex flex-row gap-2'>
                    <SystemIcons.Server className='size-4 my-auto'/>
                    <Dialog.Title>New workspace</Dialog.Title>
                </div>
                <Dialog.Description className="text-muted-foreground">
                    Its own database and its own machine. Nothing is shared with your other workspaces.
                </Dialog.Description>
            </Dialog.Header>

            <Form.Root {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" autoComplete="off">
                    <Form.Field
                        control={form.control}
                        name="displayName"
                        render={({ field }) => (
                            <Form.Item>
                                <Form.Label>Name</Form.Label>
                                <Form.Control>
                                    <Input {...field} placeholder="My workspace" autoFocus disabled={busy} />
                                </Form.Control>
                                <Form.Message />
                            </Form.Item>
                        )}
                    />

                    {/* Provisioning runs before the response returns, so this is a wait, not a flicker. */}
                    {busy && (
                        <p className="text-muted-foreground text-xs">
                            Creating the database and starting the machine…
                        </p>
                    )}

                    <Dialog.Footer>
                        {/* Closing does not abort it — provisioning continues and the
                            grid picks the workspace up when the store updates. */}
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => DialogSDK.actions.pop(dialogId)}
                        >
                            Cancel
                        </Button>

                        <Button type="submit" disabled={busy}>
                            {busy && <Spinner className="mr-2 h-4 w-4" />}
                            Create
                        </Button>
                    </Dialog.Footer>
                </form>
            </Form.Root>
        </div>
    )
}
