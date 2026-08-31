import { createFileRoute } from '@tanstack/react-router'
import { WorkspacesGrid } from '@/SDKs/WorkspaceSDK/ui/WorkspacesGrid'
import { WorkspaceSDK } from '@/SDKs/WorkspaceSDK/sdk'
import { ReleaseSDK } from '@/SDKs/ReleaseSDK'

export const Route = createFileRoute('/_app/')({
    // Fills the store before the grid renders. A failure is swallowed so the
    // route still mounts; the grid reports it.
    loader: async () => {
        // Fire and forget: badges appear when the answer lands.
        void ReleaseSDK.fetchLatest().catch(() => null)

        await WorkspaceSDK.fetchWorkspaces().catch((error) => {
            console.error('Workspace list failed to load:', error)

            return null
        })

        return null
    },
    staticData: { title: 'Workspaces' },
    component: WorkspacesGrid,
})
