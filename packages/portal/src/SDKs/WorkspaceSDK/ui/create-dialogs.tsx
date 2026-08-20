import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, Dialog, Form, Input, ScrollArea, Select, Spinner } from '@pretzel-graph/standard-ui/foundations'
import { DialogSDK } from '@pretzel-graph/standard-ui/SDKs/DialogSDK'
import { NotificationSDK } from '@pretzel-graph/standard-ui/SDKs/NotificationSDK'
import { Workspace } from '@pretzel-cloud/shared/domain'
import { WorkspaceSDK } from '../sdk'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import { ServerIllustration } from '@pretzel-graph/standard-ui/icons/illustrations'
import { useId } from 'react'

const DIALOG_CLASSNAME = 'sm:max-w-[650px] w-full'

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
    const formId = useId()

    return (
        <div className='flex flex-row  h-[500px] overflow-hidden rounded-2xl'>
            {/* Left sidebar */}
            <div className='w-[250px] flex flex-col gap-2 shrink-0 py-4 px-4'>
                <div className='flex flex-row items-center gap-2'>
                    <ServerIllustration className='size-8 shrink-0' />
                    <p className='text-md font-semibold text-foreground'>Workspace Builder</p>
                </div>
                <p className='text-xs text-muted-foreground'>Every workspace is its own isolated deployment with a private database and private compute.</p>
            </div>

            <div className='h-full bg-border w-[1px]' />

            {/* Right column */}
            <div className='flex flex-col flex-1 h-full relative'>
                {/* Header */}
                <div className='pointer-events-none absolute top-0 left-0 z-90 flex flex-row gap-2 items-center px-4 pt-6 pb-4'>
                    <p className='text-sm font-semibold text-foreground'>
                        Configure the Workspace
                    </p>
                </div>
                {/* Content */}
                <ScrollArea.Root className="h-full [mask-image:linear-gradient(to_bottom,transparent_0,transparent_40px,black_80px,black_calc(100%-80px),transparent_calc(100%-40px),transparent_100%)]">
                    <Form.Root {...form}>
                        <form id={formId} onSubmit={form.handleSubmit(onSubmit)} className='relative min-h-full pt-16 pb-20 flex flex-col gap-3 px-4' autoComplete='off'>

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

                         

                        </form>
                    </Form.Root>
                </ScrollArea.Root>

                {/* Footer */}
                <div className='pointer-events-none absolute bottom-0 left-0 right-0 pt-2 px-4 pb-4 pt-2 mt-auto w-full flex'>
                    <div className='ml-auto gap-2 flex'>
            
                        <Button type='submit' form={formId} disabled={busy} className='pointer-events-auto rounded-full' >
                            {form.formState.isSubmitting && <Spinner className='mr-2 h-4 w-4' />}
                            Save
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )

    return (
        <div className='flex flex-col h-full w-full p-4 gap-4 min-w-[600px]'>
            <div className='flex flex-row w-full gap-3 items-center'>
                <ServerIllustration className='size-10 shrink-0' />
                <h1 className='text-lg font-bold'>VAULT</h1>
            </div>

            <p className='text-sm text-muted-foreground'>
                Manage your API keys and secrets. Add credentials from a node's settings panel.
            </p>

            <div className='flex flex-col gap-2 bg-input/50 rounded-md border border-border shadow-md shadow-black/10'>
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

        </div>
    )


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
