import { createFileRoute } from '@tanstack/react-router'
import { QuerySDK } from '@pretzel-graph/standard-ui/SDKs/QuerySDK/sdk'
import { ScrollArea, Spinner } from '@pretzel-graph/standard-ui/foundations'
import { WorkspaceSDK } from '@/SDKs/WorkspaceSDK/sdk'
import { workspacesQuery } from '@/SDKs/WorkspaceSDK/ui/WorkspacesGrid'
import { WorkspaceUsage } from '@/SDKs/EntitlementSDK/ui/WorkspaceUsage'

export const Route = createFileRoute('/_app/usage')({
    loader: async () => {
        await QuerySDK.client.fetchQuery(workspacesQuery).catch(() => null)

        return null
    },
    staticData: { title: 'Usage' },
    component: UsagePage,
})

function UsagePage() {
    const { isPending } = QuerySDK.useQuery<unknown, Error>(
        workspacesQuery.queryKey,
        workspacesQuery.queryFn,
        { staleTime: workspacesQuery.staleTime },
    )

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
