import { useEffect } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import confetti from 'canvas-confetti'
import { Button, Spinner } from '@pretzel-graph/standard-ui/foundations'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import { Billing, Workspace } from '@pretzel-cloud/shared/domain'
import { WorkspaceSDK } from '@/SDKs/WorkspaceSDK/sdk'

export const Route = createFileRoute('/_app/checkout/success/$workspaceId')({
    loader: async () => {
        await WorkspaceSDK.fetchWorkspaces().catch(() => null)

        return null
    },
    staticData: { title: '' },
    component: CheckoutSuccess,
})

/** Two bursts from the lower corners, so nothing is thrown over the message. */
function celebrate() {
    const shared = { particleCount: 60, spread: 70, startVelocity: 45, ticks: 220, disableForReducedMotion: true }

    confetti({ ...shared, origin: { x: 0.15, y: 0.9 }, angle: 60 })
    confetti({ ...shared, origin: { x: 0.85, y: 0.9 }, angle: 120 })
}

function CheckoutSuccess() {
    const { workspaceId } = Route.useParams()

    const workspace = WorkspaceSDK.useStore((s) => s.workspaces[Workspace.Id.parse(workspaceId)])

    useEffect(() => { celebrate() }, [])


    return (
        <div className="flex min-h-[420px] items-center justify-center">
            <div className="flex flex-col items-center gap-6 text-center">
                <SystemIcons.CircleCheck className="text-green-500 size-10" />

                <div className="flex flex-col gap-2">
                    <h1 className="font-chivo text-3xl font-bold">Plan changed</h1>

                    <p className="text-muted-foreground max-w-sm text-sm">
                        {workspace
                            ? <>Thank you. <span className="text-foreground">{workspace.displayName}</span> is moving onto its new plan.</>
                            : <>Thank you. Your workspace is moving onto its new plan.</>}
                    </p>
                </div>

                <div className="flex h-6 items-center gap-2 text-xs">
                </div>

                <div className="flex items-center gap-2">
                    <Button asChild size="sm" variant="ghost">
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
