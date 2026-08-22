import { createFileRoute, Link } from '@tanstack/react-router'
import { Button } from '@pretzel-graph/standard-ui/foundations'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'

export const Route = createFileRoute('/_app/checkout/cancelled/$workspaceId')({
    staticData: { title: "" },
    component: CheckoutCancelled,
})

function CheckoutCancelled() {
    return (
        <div className="flex min-h-[420px] items-center justify-center">
            <div className="flex flex-col items-center gap-6 text-center">
                <SystemIcons.OctagonX className="text-destructive size-10" />

                <div className="flex flex-col gap-2">
                    <h1 className="font-chivo text-3xl font-bold">Checkout cancelled</h1>

                    <p className="text-muted-foreground max-w-sm text-sm">
                        Nothing was charged and your workspace is unchanged. You can pick a plan
                        again whenever you like.
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <Button asChild size="sm">
                        <Link to="/workspaces">
                        <SystemIcons.ArrowLeft/>
                            Back to workspaces
                        </Link>
                    </Button>
                </div>
            </div>
        </div>
    )
}
