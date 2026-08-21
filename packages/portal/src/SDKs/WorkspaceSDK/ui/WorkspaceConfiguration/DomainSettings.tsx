import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Badge, Button, Form, Input, Spinner } from '@pretzel-graph/standard-ui/foundations'
import { NotificationSDK } from '@pretzel-graph/standard-ui/SDKs/NotificationSDK'
import { Workspace } from '@pretzel-cloud/shared/domain'
import { WorkspaceSDK } from '../../sdk'

// Subdomain.Custom is branded, so what the form holds and what it produces are
// different types; useForm needs both.
const Schema = z.object({ subdomain: Workspace.Subdomain.Custom })
type Draft  = z.input<typeof Schema>
type Values = z.output<typeof Schema>

export const DomainSettings = ({ workspaceId }: { workspaceId: Workspace.Id }) => {
    const workspace = WorkspaceSDK.useStore((s) => s.workspaces[workspaceId])

    const form = useForm<Draft, unknown, Values>({
        resolver: zodResolver(Schema),
        defaultValues: { subdomain: workspace?.subdomain ?? '' },
    })

    if (!workspace) return null

    const paid = Workspace.isPaid(workspace.plan)

    const onSubmit = async (values: Values) => {
        try {
            await WorkspaceSDK.actions.setSubdomain(workspaceId, values)

            NotificationSDK.toast.success('Subdomain updated')
        }
        catch (error) {
            const replied = (error as { response?: { data?: { message?: string } } })?.response?.data?.message

            NotificationSDK.toast.error(replied ?? 'Could not set the subdomain')
        }
    }

    return (
        <div className="flex flex-col gap-6 pr-2">
            <div className="flex flex-col gap-1.5">
                <p className="text-sm font-medium">Permanent address</p>

                <code className="bg-muted text-muted-foreground w-fit rounded-md px-2 py-1 text-xs">
                    {Workspace.Subdomain.canonical(workspace.id)}
                </code>

                <p className="text-muted-foreground text-xs">
                    Derived from the workspace id and never changes, so a webhook URL keeps
                    working whatever else is renamed.
                </p>
            </div>

            <Form.Root {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-3">
                    <Form.Field
                        control={form.control}
                        name="subdomain"
                        render={({ field }) => (
                            <Form.Item>
                                <Form.Label className="flex items-center gap-2">
                                    Custom subdomain
                                    {!paid && <Badge variant="outline" size="xs">Pro</Badge>}
                                </Form.Label>
                                <Form.Control>
                                    <Input {...field} disabled={!paid} placeholder="my-team" />
                                </Form.Control>
                                <Form.Description className="text-muted-foreground text-xs">
                                    An extra address. The permanent one stays registered either way.
                                </Form.Description>
                                <Form.Message />
                            </Form.Item>
                        )}
                    />

                    <Button
                        type="submit"
                        size="sm"
                        className="mr-auto"
                        disabled={!paid || form.formState.isSubmitting || !form.formState.isDirty}
                    >
                        {form.formState.isSubmitting && <Spinner className="mr-2 h-4 w-4" />}
                        Save
                    </Button>
                </form>
            </Form.Root>
        </div>
    )
}
