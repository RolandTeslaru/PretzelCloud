import { createFileRoute, Link } from '@tanstack/react-router'

// Public. The marketing entry point, and where a signed-out visitor lands.
export const Route = createFileRoute('/')({
    component: Landing,
})

function Landing() {
    return (
        <div className="text-foreground flex min-h-screen items-center justify-center">
            <div className="text-center">
                <h1 className="font-chivo text-4xl font-bold">Pretzel</h1>

                <p className="text-muted-foreground mt-3 text-sm">
                    Visual agent workflow editor.
                </p>

                <Link
                    to="/workspaces"
                    className="border-border hover:bg-muted mt-8 inline-block rounded-md border px-4 py-2 text-sm"
                >
                    Go to your workspaces →
                </Link>
            </div>
        </div>
    )
}
