import { createFileRoute } from '@tanstack/react-router'
import { WorkspacesGrid } from '@/SDKs/WorkspaceSDK/ui/WorkspacesGrid'
import { WorkspaceSDK } from '@/SDKs/WorkspaceSDK/sdk'
import { ReleaseSDK } from '@/SDKs/ReleaseSDK'

export const Route = createFileRoute('/_app/')({
    loader: () => {
        void ReleaseSDK.prefetch(ReleaseSDK.query.latest)
        void WorkspaceSDK.prefetch(WorkspaceSDK.query.workspacesList)

        return null
    },
    staticData: { title: 'Workspaces' },
    component: WorkspacesGrid,
})
