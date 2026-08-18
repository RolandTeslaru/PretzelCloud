import { useState } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@pretzel-graph/standard-ui/foundations/button'
import { Form } from '@pretzel-graph/standard-ui/foundations/form'
import { Input } from '@pretzel-graph/standard-ui/foundations/input'
import { AuthSDK } from '@/SDKs/AuthSDK/sdk'

export const Route = createFileRoute('/auth/')({
    beforeLoad: ({ context }) => {
        if (context.auth.isAuthenticated) {
            throw redirect({ to: '/workspaces' })
        }
    },
    component: AuthPage,
})

// Email and password only. The display name is edited on the profile.
const credentials = z.object({
    email:    z.email(),
    password: z.string().min(8, 'At least 8 characters'),
})

type Credentials = z.infer<typeof credentials>

function AuthPage() {
    const router = useRouter()

    const [variant, setVariant] = useState<'login' | 'signup'>('login')
    const [disabled, setDisabled] = useState(false)

    const form = useForm<Credentials>({
        resolver: zodResolver(credentials),
        defaultValues: { email: '', password: '' },
        disabled,
    })

    async function onSubmit(values: Credentials) {
        setDisabled(true)

        const success = variant === 'login'
            ? await AuthSDK.actions.login(values)
            : await AuthSDK.actions.signup(values)

        setDisabled(false)

        if (success) {
            router.navigate({ to: '/workspaces' })
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
                    onClick={() => setVariant(variant === 'login' ? 'signup' : 'login')}
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
