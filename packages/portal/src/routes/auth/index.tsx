import { useEffect, useState } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { User } from '@pretzel-cloud/shared/domain'
import { Button, Form, Input, Spinner, Tabs } from '@pretzel-graph/standard-ui/foundations'
import { NotificationSDK } from '@pretzel-graph/standard-ui/SDKs/NotificationSDK'
import { AuthSDK } from '@/SDKs/AuthSDK/sdk'
import { AuthLayout } from '@/SDKs/AuthSDK/ui/AuthLayout'
import { getMessageFromError } from '@/SDKs/api'

export const Route = createFileRoute('/auth/')({
    beforeLoad: ({ context }) => {
        if (context.auth.isAuthenticated) {
            throw redirect({ to: '/' })
        }
    },
    component: AuthPage,
})

type Variant = 'login' | 'signup'

/** Reports the first failure against `path`, or nothing if the value is fine. */
function check(schema: z.ZodType, value: unknown, path: string, ctx: z.RefinementCtx) {
    const result = schema.safeParse(value)

    if (!result.success) {
        ctx.addIssue({ code: 'custom', path: [path], message: result.error.issues[0]!.message })
    }
}

// One schema for both tabs: the profile fields exist either way, and are only
// required when the form is rendering them. Switching tabs keeps what was typed.
const credentials = z.object({
    variant:     z.enum(['login', 'signup']),
    email:       z.email(),
    password:    z.string().min(8, 'At least 8 characters'),
    username:    z.string(),
    displayName: z.string(),
}).superRefine((values, ctx) => {
    if (values.variant !== 'signup') return

    check(User.Username,    values.username,    'username',    ctx)
    check(User.DisplayName, values.displayName, 'displayName', ctx)
})

type Credentials = z.infer<typeof credentials>

// The names alone: the session already exists, so there is nothing else to ask.
const profile = z.object({
    username:    User.Username,
    displayName: User.DisplayName,
})

type ProfileDraft  = z.input<typeof profile>
type ProfileValues = z.output<typeof profile>

const isConflict = (error: unknown) =>
    (error as { response?: { status?: number } })?.response?.status === 409

const PROVIDER_LABELS: Record<AuthSDK.Provider, string> = {
    github: 'GitHub',
}

/**
 * Two panels behind one address. A session without a profile means sign-up got
 * as far as the issuer and no further, so the names are asked for on their own.
 */
function AuthPage() {
    const needsProfile = AuthSDK.useStore(s => s.needsProfile)

    return (
        <AuthLayout>
            {needsProfile ? <ProfilePanel /> : <CredentialsPanel />}
        </AuthLayout>
    )
}

function CredentialsPanel() {
    const router = useRouter()

    const providers = AuthSDK.useStore(s => s.providers)

    const [disabled, setDisabled] = useState(false)

    const form = useForm<Credentials>({
        resolver: zodResolver(credentials),
        defaultValues: { variant: 'login', email: '', password: '', username: '', displayName: '' },
        disabled,
    })

    const variant: Variant = form.watch('variant')

    async function onSubmit(values: Credentials) {
        setDisabled(true)

        const success = values.variant === 'login'
            ? await AuthSDK.actions.login({ email: values.email, password: values.password })
            : await AuthSDK.actions.signup(values)

        setDisabled(false)

        if (success) {
            router.navigate({ to: '/' })
        }
    }

    async function onProvider(provider: AuthSDK.Provider) {
        setDisabled(true)

        // On success the page is leaving; only a failure needs the form back.
        const success = await AuthSDK.actions.loginWithProvider(provider)

        if (!success) {
            setDisabled(false)
        }
    }

    return (
        <div className="flex flex-col gap-2 p-2">
            <Tabs.Root
                value={variant}
                onValueChange={(value) => form.setValue('variant', value as Variant)}
            >
                <Tabs.List>
                    <Tabs.Trigger className="w-full" value="login">Login</Tabs.Trigger>
                    <Tabs.Trigger className="w-full" value="signup">Sign Up</Tabs.Trigger>
                </Tabs.List>
            </Tabs.Root>



            <Form.Root {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <Form.Field
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                            <Form.Item>
                                <Form.Label>Email</Form.Label>
                                <Form.Control>
                                    <Input type="email" autoComplete="email" {...field} />
                                </Form.Control>
                                <Form.Message />
                            </Form.Item>
                        )}
                    />

                    <Form.Field
                        control={form.control}
                        name="password"
                        render={({ field }) => (
                            <Form.Item>
                                <Form.Label>Password</Form.Label>
                                <Form.Control>
                                    <Input
                                        type="password"
                                        autoComplete={variant === 'login' ? 'current-password' : 'new-password'}
                                        {...field}
                                    />
                                </Form.Control>
                                <Form.Message />
                            </Form.Item>
                        )}
                    />

                    {variant === 'signup' && (
                        <>
                            <Form.Field
                                control={form.control}
                                name="username"
                                render={({ field }) => (
                                    <Form.Item>
                                        <Form.Label>Username</Form.Label>
                                        <Form.Control>
                                            <Input autoComplete="username" {...field} />
                                        </Form.Control>
                                        <Form.Message />
                                    </Form.Item>
                                )}
                            />

                            <Form.Field
                                control={form.control}
                                name="displayName"
                                render={({ field }) => (
                                    <Form.Item>
                                        <Form.Label>Display Name</Form.Label>
                                        <Form.Control>
                                            <Input autoComplete="name" {...field} />
                                        </Form.Control>
                                        <Form.Message />
                                    </Form.Item>
                                )}
                            />
                        </>
                    )}

                    <Form.Item>
                        <Button type="submit" disabled={disabled}>
                            {disabled
                                ? <Spinner />
                                : variant === 'login' ? 'Login' : 'Sign up'}
                        </Button>
                    </Form.Item>
                </form>
            </Form.Root>
            {providers.length > 0 && (
                <>

                    <div className="text-muted-foreground my-2 flex items-center gap-3 text-xs">
                        <div className="bg-border h-px flex-1" />
                        or
                        <div className="bg-border h-px flex-1" />
                    </div>

                    <div className="space-y-2">
                        {providers.map(provider => (
                            <Button
                                key={provider}
                                type="button"
                                variant="input"
                                disabled={disabled}
                                className="w-full gap-2"
                                onClick={() => onProvider(provider)}
                            >
                                <ProviderIcon provider={provider} />
                                Continue with {PROVIDER_LABELS[provider]}
                            </Button>
                        ))}
                    </div>

                    
                </>
            )}
        </div>
    )
}

/**
 * The last step of a sign-up that came through a provider, or one that
 * stopped after the issuer. Starts from what the provider said, if anything.
 */
function ProfilePanel() {
    const router = useRouter()

    const [disabled, setDisabled] = useState(false)

    const form = useForm<ProfileDraft, unknown, ProfileValues>({
        resolver: zodResolver(profile),
        defaultValues: { username: '', displayName: '' },
        disabled,
    })

    useEffect(() => {
        let cancelled = false

        AuthSDK.actions.suggestProfile().then(suggested => {
            if (!cancelled) {
                form.reset(suggested)
            }
        })

        return () => { cancelled = true }
    }, [form])

    async function onSubmit(values: ProfileValues) {
        setDisabled(true)

        try {
            await AuthSDK.actions.register(values)

            router.navigate({ to: '/' })
        }
        catch (error) {
            const message = getMessageFromError(error)

            if (isConflict(error)) {
                form.setError('username', { message })
            }
            else {
                NotificationSDK.toast.error(message)
            }
        }

        setDisabled(false)
    }

    return (
        <div className="flex flex-col gap-2 p-2">
            <div className="text-center">
                <p className="font-semibold">Finish setting up</p>
                <p className="text-muted-foreground text-xs">Choose how you appear to the people you work with.</p>
            </div>

            <Form.Root {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <Form.Field
                        control={form.control}
                        name="username"
                        render={({ field }) => (
                            <Form.Item>
                                <Form.Label>Username</Form.Label>
                                <Form.Control>
                                    <Input autoComplete="username" {...field} />
                                </Form.Control>
                                <Form.Message />
                            </Form.Item>
                        )}
                    />

                    <Form.Field
                        control={form.control}
                        name="displayName"
                        render={({ field }) => (
                            <Form.Item>
                                <Form.Label>Display Name</Form.Label>
                                <Form.Control>
                                    <Input autoComplete="name" {...field} />
                                </Form.Control>
                                <Form.Message />
                            </Form.Item>
                        )}
                    />

                    <Form.Item>
                        <Button type="submit" disabled={disabled}>
                            {disabled ? <Spinner /> : 'Continue'}
                        </Button>
                    </Form.Item>
                </form>
            </Form.Root>

            <button
                type="button"
                onClick={() => AuthSDK.actions.logout()}
                className="text-muted-foreground hover:text-foreground mt-2 w-full text-center text-xs"
            >
                Not you? Sign out
            </button>
        </div>
    )
}

function ProviderIcon({ provider }: { provider: AuthSDK.Provider }) {
    if (provider === 'github') {
        return (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
            </svg>
        )
    }

    return null
}
