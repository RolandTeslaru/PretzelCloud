import { useState } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { User } from '@pretzel-cloud/shared/domain'
import { Button } from '@pretzel-graph/standard-ui/foundations/button'
import { Form } from '@pretzel-graph/standard-ui/foundations/form'
import { Input } from '@pretzel-graph/standard-ui/foundations/input'
import { AuthSDK } from '@/SDKs/AuthSDK/sdk'

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

// One schema for both variants: the profile fields exist either way, and are
// only required when the form is rendering them.
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

function AuthPage() {
    const router = useRouter()

    const [disabled, setDisabled] = useState(false)

    const form = useForm<Credentials>({
        resolver: zodResolver(credentials),
        defaultValues: { variant: 'login', email: '', password: '', username: '', displayName: '' },
        disabled,
    })

    const variant = form.watch('variant')

    const toggle = () => form.setValue('variant', variant === 'login' ? 'signup' : 'login')

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

    return (
        <div className="bg-background text-foreground flex min-h-screen items-center justify-center">
            <div className="border-border w-80 rounded-xl border p-6">
                <h1 className="font-chivo text-xl font-semibold">
                    {variant === 'login' ? 'Sign in' : 'Create an account'}
                </h1>

                <Form.Root {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 space-y-4">
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
                                            <Form.Label>Display name</Form.Label>
                                            <Form.Control>
                                                <Input autoComplete="name" {...field} />
                                            </Form.Control>
                                            <Form.Message />
                                        </Form.Item>
                                    )}
                                />
                            </>
                        )}

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

                        <Button type="submit" disabled={disabled} className="w-full">
                            {variant === 'login' ? 'Sign in' : 'Sign up'}
                        </Button>
                    </form>
                </Form.Root>

                <button
                    type="button"
                    onClick={toggle}
                    className="text-muted-foreground hover:text-foreground mt-4 w-full text-center text-xs"
                >
                    {variant === 'login'
                        ? 'No account? Create one'
                        : 'Already have an account? Sign in'}
                </button>
            </div>
        </div>
    )
}
