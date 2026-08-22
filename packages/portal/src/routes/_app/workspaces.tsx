import { createFileRoute } from '@tanstack/react-router'
import { QuerySDK } from '@pretzel-graph/standard-ui/SDKs/QuerySDK/sdk'
import { WorkspacesGrid, workspacesQuery } from '@/SDKs/WorkspaceSDK/ui/WorkspacesGrid'

export const Route = createFileRoute('/_app/workspaces')({
    // Fills the store before the grid renders. A failure is swallowed so the
    // route still mounts; the grid reports it.
    loader: async () => {
        await QuerySDK.client.fetchQuery(workspacesQuery).catch(() => null)

        return null
    },
    staticData: { title: 'Workspaces' },
    component: WorkspacesGrid,
})
