import { createFileRoute } from '@tanstack/react-router'
import { WorkspacesGrid } from '@/SDKs/WorkspaceSDK/ui/WorkspacesGrid'
import { WorkspaceSDK } from '@/SDKs/WorkspaceSDK/sdk'
import { ReleaseSDK } from '@/SDKs/ReleaseSDK'

export const Route = createFileRoute('/_app/')({
    loader: () => {
        void ReleaseSDK.fetch(ReleaseSDK.query.latest).catch(() => null)
        void WorkspaceSDK.fetch(WorkspaceSDK.query.workspacesList).catch(() => null)

        return null
    },
    staticData: { title: 'Workspaces' },
    component: WorkspacesGrid,
})
