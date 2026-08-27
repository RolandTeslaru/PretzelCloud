import { createFileRoute } from '@tanstack/react-router'
import { ScrollArea, Spinner } from '@pretzel-graph/standard-ui/foundations'
import { WorkspaceSDK } from '@/SDKs/WorkspaceSDK/sdk'
import { WorkspaceUsage } from '@/SDKs/EntitlementSDK/ui/WorkspaceUsage'

export const Route = createFileRoute('/_app/usage')({
    loader: async () => {
        await WorkspaceSDK.fetchWorkspaces().catch(() => null)

        return null
    },
    staticData: { title: 'Usage' },
    component: UsagePage,
})

function UsagePage() {
    const { isPending } = WorkspaceSDK.useWorkspacesQuery()

    const workspaces = WorkspaceSDK.useStore((s) => Object.values(s.workspaces))

    if (isPending && workspaces.length === 0)
        return (
            <div className='flex justify-center py-10'>
                <Spinner className='size-4' />
            </div>
        )

    if (workspaces.length === 0)
        return (
            <p className='text-muted-foreground text-sm'>
                No workspaces yet.
            </p>
        )

    return (
        <div className='flex flex-col gap-10 overflow-hidden!'>
                {workspaces.map((workspace) => (
                    <WorkspaceUsage key={workspace.id} workspace={workspace} />
                ))}
        </div>
    )
}
