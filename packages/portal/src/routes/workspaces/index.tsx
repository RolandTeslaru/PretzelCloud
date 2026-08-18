import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Workspace } from '@pretzel-cloud/shared/domain'
import { Button } from '@pretzel-graph/standard-ui/foundations/button'
import { Card } from '@pretzel-graph/standard-ui/foundations/card'
import { AuthSDK } from '@/SDKs/AuthSDK/sdk'
import { api } from '@/SDKs/api'

export const Route = createFileRoute('/workspaces/')({
    beforeLoad: ({ context }) => {
        if (!context.auth.isAuthenticated) {
            throw redirect({ to: '/auth' })
        }
    },
    component: Workspaces,
})

async function listWorkspaces(): Promise<Workspace.Card[]> {
    const response = await api.get('/api/workspaces')

    return Workspace.API.List.Response.parse(response.data).workspaces
}

function Workspaces() {
    const user = AuthSDK.useStore(s => s.user)

    const { data, isPending, error } = useQuery({
        queryKey: ['workspaces'],
        queryFn: listWorkspaces,
    })

    return (
        <div className="bg-background text-foreground min-h-screen">
            <header className="border-border flex items-center justify-between border-b px-8 py-4">
                <span className="font-chivo text-lg">Pretzel</span>

                <div className="flex items-center gap-4">
                    <span className="text-muted-foreground text-sm">{user?.displayName}</span>

                    <Button variant="ghost" onClick={() => AuthSDK.actions.logout()}>
                        Sign out
                    </Button>
                </div>
            </header>

            <main className="mx-auto max-w-5xl px-8 py-10">
                <h1 className="text-xl font-medium">Workspaces</h1>

                {isPending && <p className="text-muted-foreground mt-4 text-sm">Loading…</p>}

                {error && <p className="text-destructive mt-4 text-sm">{error.message}</p>}

                {data && data.length === 0 && (
                    <p className="text-muted-foreground mt-4 text-sm">Nothing here yet.</p>
                )}

                <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">
                    {data?.map((workspace) => (
                        <Card.Root key={workspace.id}>
                            <Card.Header>
                                <Card.Title>{workspace.displayName}</Card.Title>
                                <Card.Description>{workspace.status}</Card.Description>
                            </Card.Header>
                        </Card.Root>
                    ))}
                </div>
            </main>
        </div>
    )
}
