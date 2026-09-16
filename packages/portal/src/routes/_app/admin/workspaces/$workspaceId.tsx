import { createFileRoute } from '@tanstack/react-router'
import { Workspace } from '@pretzel-cloud/shared/domain'
import { AdminSDK } from '@/SDKs/AdminSDK'
import { AdminWorkspace } from '@/SDKs/AdminSDK/ui/AdminWorkspace'

export const Route = createFileRoute('/_app/admin/workspaces/$workspaceId')({
    loader: ({ params }) => {
        void AdminSDK.prefetch(AdminSDK.query.workspace(params.workspaceId as Workspace.Id))

        return null
    },
    staticData: { title: 'Workspace' },
    component: AdminWorkspacePage,
})

function AdminWorkspacePage() {
    const { workspaceId } = Route.useParams()

    return <AdminWorkspace workspaceId={workspaceId as Workspace.Id} />
}
