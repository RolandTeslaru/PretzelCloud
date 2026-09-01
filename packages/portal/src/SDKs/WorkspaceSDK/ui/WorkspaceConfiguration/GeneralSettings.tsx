import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, Form, Input, Spinner } from '@pretzel-graph/standard-ui/foundations'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import { NotificationSDK } from '@pretzel-graph/standard-ui/SDKs/NotificationSDK'
import { Workspace } from '@pretzel-cloud/shared/domain'
import { WorkspaceSDK } from '../../sdk'

const Schema = z.object({ displayName: Workspace.DisplayName })
type Values = z.infer<typeof Schema>

export const GeneralSettings = ({ workspaceId }: { workspaceId: Workspace.Id }) => {
    const workspace = WorkspaceSDK.useStore((s) => s.workspaces[workspaceId])

    const form = useForm<Values>({
        resolver: zodResolver(Schema),
        defaultValues: { displayName: workspace?.displayName ?? '' },
    })

    if (!workspace) return null

    const onSubmit = async (values: Values) => {
        try {
            await WorkspaceSDK.actions.rename(workspaceId, values)

            NotificationSDK.toast.success('Workspace renamed')
        }
        catch {
            NotificationSDK.toast.error('Could not rename the workspace')
        }
    }

    return (
        <Form.Root {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-3">
                <div className="flex flex-col gap-6 px-1">
                    <Form.Field
                        control={form.control}
                        name="displayName"
                        render={({ field }) => (
                            <Form.Item>
                                <Form.Label>Workspace Name</Form.Label>
                                <Form.Control><Input {...field} /></Form.Control>
                                <Form.Message />
                            </Form.Item>
                        )}
                    />



                    <div className="flex flex-col gap-1.5">
                        <p className="text-sm font-medium">Workspace ID</p>

                        <div className="flex items-center gap-2">
                            <code className="bg-muted text-muted-foreground rounded-md px-2 py-1 text-xs">
                                {workspace.id}
                            </code>

                            <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                onClick={() => navigator.clipboard.writeText(workspace.id)
                                    .then(() => NotificationSDK.toast.success('Workspace ID copied'))
                                    .catch(() => NotificationSDK.toast.error('Could not reach the clipboard'))}
                            >
                                <SystemIcons.Copy />
                            </Button>
                        </div>
                    </div>

                    <div className='flex flex-row absolute gap-2 bottom-0 left-0 w-full p-4 '>
                        <Button
                            type="submit"
                            size="sm"
                            className="ml-auto"
                            disabled={form.formState.isSubmitting || !form.formState.isDirty}
                        >
                            {form.formState.isSubmitting && <Spinner className="mr-2 h-4 w-4" />}
                            Save
                        </Button>
                    </div>
                </div>
            </form>

        </Form.Root>

    )
}
