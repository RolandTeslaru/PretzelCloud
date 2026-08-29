import { createFileRoute } from '@tanstack/react-router'
import { WorkspacesGrid } from '@/SDKs/WorkspaceSDK/ui/WorkspacesGrid'
import { WorkspaceSDK } from '@/SDKs/WorkspaceSDK/sdk'

export const Route = createFileRoute('/_app/')({
    // Fills the store before the grid renders. A failure is swallowed so the
    // route still mounts; the grid reports it.
    loader: async () => {
        await WorkspaceSDK.fetchWorkspaces().catch(() => null)

        return null
    },
    staticData: { title: 'Workspaces' },
    component: WorkspacesGrid,
})
