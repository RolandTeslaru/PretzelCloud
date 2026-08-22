import { useId } from 'react'
import type { CSSProperties } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, Form, Input, ScrollArea, Spinner } from '@pretzel-graph/standard-ui/foundations'
import { SidebarTabs } from '@pretzel-graph/standard-ui/components/SidebarTabs'
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

type SurfaceProps = { surfaceStyle: CSSProperties; blockTransparency: boolean }

export function openCreateWorkspaceDialog() {
    DialogSDK.actions.push(DIALOG_ID, (props) => (
        <DialogSDK.UnstyledTemplate {...props}>
            <CreateWorkspaceContent
                dialogId={DIALOG_ID}
                surfaceStyle={props.surfaceStyle}
                blockTransparency={props.blockTransparency}
            />
        </DialogSDK.UnstyledTemplate>
    ))
}

function CreateWorkspaceContent({ dialogId, surfaceStyle, blockTransparency }: { dialogId: string } & SurfaceProps) {
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

    // No tabs to show: the shell is here for its surfaces and layout, and both
    // halves are drawn below.
    return (
        <SidebarTabs
            surfaceStyle={surfaceStyle}
            blockTransparency={blockTransparency}
            className='w-[650px] min-h-[500px]'
            sidebarClassName='w-[250px] py-4 px-4'
            contentClassName='max-h-[500px] px-0'

            sidebarRenderer={() => (
                <div className='flex flex-col gap-2'>
                    <div className='flex flex-row items-center gap-2'>
                        <ServerIllustration className='size-8 shrink-0' />
                        <p className='text-md font-semibold text-foreground'>Workspace Builder</p>
                    </div>

                    <p className='text-xs text-muted-foreground'>
                        Every workspace is its own isolated deployment with a private database and private compute.
                    </p>
                </div>
            )}

            contentRenderer={() => (
                <div className='flex flex-col h-full relative'>
                    <div className='pointer-events-none absolute top-0 left-0 z-90 flex flex-row gap-2 items-center px-4 pt-6 pb-4'>
                        <p className='text-sm font-semibold text-foreground'>
                            Configure the Workspace
                        </p>
                    </div>

                    <ScrollArea.Root className="h-full [mask-image:linear-gradient(to_bottom,transparent_0,transparent_40px,black_80px,black_calc(100%-80px),transparent_calc(100%-40px),transparent_100%)]">
                        <Form.Root {...form}>
                            <form
                                id={formId}
                                onSubmit={form.handleSubmit(onSubmit)}
                                className='relative min-h-full pt-16 pb-20 flex flex-col gap-3 px-4'
                                autoComplete='off'
                            >
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

                    <div className='pointer-events-none absolute bottom-0 left-0 right-0 px-4 pb-4 pt-2 mt-auto w-full flex'>
                        <div className='ml-auto gap-2 flex'>
                            <Button type='submit' form={formId} disabled={busy} className='pointer-events-auto rounded-full'>
                                {busy && <Spinner className='mr-2 h-4 w-4' />}
                                Save
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        />
    )
}
