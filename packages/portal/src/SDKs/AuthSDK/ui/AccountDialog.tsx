import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, Dialog, Form, Input, Spinner } from '@pretzel-graph/standard-ui/foundations'
import { DialogSDK } from '@pretzel-graph/standard-ui/SDKs/DialogSDK'
import { NotificationSDK } from '@pretzel-graph/standard-ui/SDKs/NotificationSDK'
import { User } from '@pretzel-cloud/shared/domain'
import { AuthSDK } from '../sdk'

const DIALOG_ID = 'account'

const Schema = z.object({
    username:    User.Username,
    displayName: User.DisplayName,
})
type Draft  = z.input<typeof Schema>
type Values = z.output<typeof Schema>

export function openAccountDialog() {
    DialogSDK.actions.push(DIALOG_ID, (props) => (
        <DialogSDK.Template {...props} className='sm:max-w-[440px] w-full'>
            <AccountContent />
        </DialogSDK.Template>
    ))
}

function AccountContent() {
    const user = AuthSDK.useStore((s) => s.user)

    const form = useForm<Draft, unknown, Values>({
        resolver: zodResolver(Schema),
        defaultValues: { username: user?.username ?? '', displayName: user?.displayName ?? '' },
    })

    if (!user) return null

    const onSubmit = async (values: Values) => {
        try {
            await AuthSDK.actions.updateMe(values)

            NotificationSDK.toast.success('Account updated')
            DialogSDK.actions.pop(DIALOG_ID)
        }
        catch (error) {
            const replied = (error as { response?: { data?: { message?: string } } })?.response?.data?.message

            // A taken username belongs on the field, not only in a toast.
            if (replied?.toLowerCase().includes('username')) {
                form.setError('username', { message: replied })
                return
            }

            NotificationSDK.toast.error(replied ?? 'Could not update your account')
        }
    }

    return (
        <div className='flex flex-col gap-4 p-3'>
            <Dialog.Header className='my-1'>
                <Dialog.Title>Account</Dialog.Title>
                <Dialog.Description className='text-muted-foreground'>
                    How this deployment shows you. The address you sign in with is held by the
                    identity provider.
                </Dialog.Description>
            </Dialog.Header>

            <Form.Root {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className='flex flex-col gap-4' autoComplete='off'>
                    <Form.Item>
                        <Form.Label>Email</Form.Label>
                        <Input value={user.email} readOnly disabled />
                    </Form.Item>

                    <Form.Field
                        control={form.control}
                        name='username'
                        render={({ field }) => (
                            <Form.Item>
                                <Form.Label>Username</Form.Label>
                                <Form.Control><Input {...field} /></Form.Control>
                                <Form.Message />
                            </Form.Item>
                        )}
                    />

                    <Form.Field
                        control={form.control}
                        name='displayName'
                        render={({ field }) => (
                            <Form.Item>
                                <Form.Label>Display name</Form.Label>
                                <Form.Control><Input {...field} /></Form.Control>
                                <Form.Message />
                            </Form.Item>
                        )}
                    />

                    <Dialog.Footer>
                        <Button type='button' variant='outline' onClick={() => DialogSDK.actions.pop(DIALOG_ID)}>
                            Cancel
                        </Button>
                        <Button type='submit' disabled={form.formState.isSubmitting || !form.formState.isDirty}>
                            {form.formState.isSubmitting && <Spinner className='mr-2 h-4 w-4' />}
                            Save
                        </Button>
                    </Dialog.Footer>
                </form>
            </Form.Root>
        </div>
    )
}
