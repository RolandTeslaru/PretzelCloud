import { useId, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, Form, Input, ScrollArea, Spinner } from '@pretzel-graph/standard-ui/foundations'
import { SidebarTabs } from '@pretzel-graph/standard-ui/components/SidebarTabs'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import { DialogSDK } from '@pretzel-graph/standard-ui/SDKs/DialogSDK'
import { NotificationSDK } from '@pretzel-graph/standard-ui/SDKs/NotificationSDK'
import { User } from '@pretzel-cloud/shared/domain'
import { AuthSDK } from '../sdk'

const DIALOG_ID = 'account'

const ROW   = 'flex flex-row items-center justify-between gap-4 min-h-9'
const LABEL = 'text-sm text-muted-foreground font-normal'
const FIELD = 'h-7 w-[220px]'

const Schema = z.object({
    username:    User.Username,
    displayName: User.DisplayName,
})
type Draft  = z.input<typeof Schema>
type Values = z.output<typeof Schema>

type SurfaceProps = { surfaceStyle: CSSProperties; blockTransparency: boolean }

export function openAccountDialog() {
    DialogSDK.actions.push(DIALOG_ID, (props) => (
        <DialogSDK.UnstyledTemplate {...props}>
            <AccountContent surfaceStyle={props.surfaceStyle} blockTransparency={props.blockTransparency} />
        </DialogSDK.UnstyledTemplate>
    ))
}

const Row = ({ label, value }: { label: string; value: ReactNode }) => (
    <div className={ROW}>
        <span className={LABEL}>{label}</span>
        <span className='text-sm font-medium truncate'>{value}</span>
    </div>
)

function AccountContent({ surfaceStyle, blockTransparency }: SurfaceProps) {
    const user = AuthSDK.useStore((s) => s.user)

    const [isEditing, setIsEditing] = useState(false)

    const form = useForm<Draft, unknown, Values>({
        resolver: zodResolver(Schema),
        defaultValues: { username: user?.username ?? '', displayName: user?.displayName ?? '' },
    })

    const formId = useId()

    if (!user) return null

    const memberSince = user.createdAt.toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric',
    })

    const onSubmit = async (values: Values) => {
        try {
            await AuthSDK.actions.updateMe(values)

            NotificationSDK.toast.success('Account updated')
            setIsEditing(false)
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

    // Discards whatever was typed, so reopening Edit starts from what is stored.
    const cancelEditing = () => {
        form.reset({ username: user.username, displayName: user.displayName })
        setIsEditing(false)
    }

    const busy = form.formState.isSubmitting

    // The issuer owns these, so they are shown in both modes and editable in neither.
    const staticRows = (
        <>
            <Row label='Email' value={user.email} />
            <Row label='Member since' value={memberSince} />
        </>
    )

    // No tabs: the shell is here for its surfaces and layout, and both halves are drawn below.
    return (
        <SidebarTabs
            surfaceStyle={surfaceStyle}
            blockTransparency={blockTransparency}
            className='w-[600px] h-[420px] min-h-[420px]'
            sidebarClassName='w-[220px] py-4 px-4'
            contentClassName='max-h-[420px] px-0'

            sidebarRenderer={() => (
                <div className='flex flex-col gap-2'>
                    <div className='flex flex-row items-center gap-2'>
                        <SystemIcons.User className='size-8 shrink-0' />
                        <p className='text-md font-semibold text-foreground'>Account</p>
                    </div>

                    <p className='text-xs text-muted-foreground'>
                        How this deployment shows you. The address you sign in with is held by the identity provider.
                    </p>
                </div>
            )}

            contentRenderer={() => (
                // inset-0 rather than h-full: inside the shell's scroll viewport there is no
                // definite height to resolve against, and the pinned footer would ride up
                // against the bottom of the content instead of the panel.
                <div className='absolute inset-0 flex flex-col'>
                    <div className='pointer-events-none absolute top-0 left-0 z-90 flex flex-row gap-2 items-center px-4 pt-6 pb-4'>
                        <p className='text-sm font-semibold text-foreground'>Your profile</p>
                    </div>

                    <ScrollArea.Root className="h-full [mask-image:linear-gradient(to_bottom,transparent_0,transparent_40px,black_80px,black_calc(100%-80px),transparent_calc(100%-40px),transparent_100%)]">
                        {isEditing ? (
                            <Form.Root {...form}>
                                <form
                                    id={formId}
                                    onSubmit={form.handleSubmit(onSubmit)}
                                    className='relative min-h-full pt-16 pb-20 flex flex-col px-4'
                                    autoComplete='off'
                                >
                                    <Form.Field control={form.control} name='displayName' render={({ field }) => (
                                        <Form.Item className={ROW}>
                                            <Form.Label className={LABEL}>Display name</Form.Label>
                                            <div className='flex flex-col items-end gap-1 py-1'>
                                                <Form.Control>
                                                    <Input {...field} className={FIELD} autoFocus autoComplete='off' />
                                                </Form.Control>
                                                <Form.Message />
                                            </div>
                                        </Form.Item>
                                    )} />

                                    <Form.Field control={form.control} name='username' render={({ field }) => (
                                        <Form.Item className={ROW}>
                                            <Form.Label className={LABEL}>Username</Form.Label>
                                            <div className='flex flex-col items-end gap-1 py-1'>
                                                <Form.Control>
                                                    <Input {...field} className={FIELD} autoComplete='off' />
                                                </Form.Control>
                                                <Form.Message />
                                            </div>
                                        </Form.Item>
                                    )} />

                                    {staticRows}
                                </form>
                            </Form.Root>
                        ) : (
                            <div className='relative min-h-full pt-16 pb-20 flex flex-col px-4'>
                                <Row label='Display name' value={user.displayName} />
                                <Row label='Username' value={`@${user.username}`} />
                                {staticRows}
                            </div>
                        )}
                    </ScrollArea.Root>

                    <div className='pointer-events-none absolute bottom-0 left-0 right-0 px-4 pb-4 pt-2 w-full flex'>
                        <div className='ml-auto gap-2 flex'>
                            {isEditing ? (
                                <>
                                    <Button
                                        type='button'
                                        variant='ghost'
                                        className='pointer-events-auto rounded-full'
                                        onClick={cancelEditing}
                                        disabled={busy}
                                    >
                                        Cancel
                                    </Button>

                                    <Button
                                        type='submit'
                                        form={formId}
                                        className='pointer-events-auto rounded-full'
                                        disabled={busy || !form.formState.isDirty}
                                    >
                                        {busy && <Spinner className='mr-2 h-4 w-4' />}
                                        Save
                                    </Button>
                                </>
                            ) : (
                                <>
                                    <Button
                                        type='button'
                                        variant='ghost'
                                        className='pointer-events-auto rounded-full'
                                        onClick={() => DialogSDK.actions.pop(DIALOG_ID)}
                                    >
                                        Close
                                    </Button>

                                    <Button
                                        type='button'
                                        className='pointer-events-auto rounded-full'
                                        onClick={() => setIsEditing(true)}
                                    >
                                        <SystemIcons.SquarePen className='mr-2 size-4' />
                                        Edit
                                    </Button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        />
    )
}
