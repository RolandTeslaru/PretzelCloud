import { createFileRoute } from '@tanstack/react-router'
import { Workspace } from '@pretzel-cloud/shared/domain'
import { AdminSDK } from '@/SDKs/AdminSDK'
import { AdminWorkspace } from '@/SDKs/AdminSDK/ui/AdminWorkspace'

export const Route = createFileRoute('/_app/admin/workspaces/$workspaceId')({
    // Fills the store before the page renders; a failure is left for the page to report.
    loader: async ({ params }) => {
        await AdminSDK.fetchWorkspace(params.workspaceId as Workspace.Id).catch(() => null)

        return null
    },
    staticData: { title: 'Workspace' },
    component: AdminWorkspacePage,
})

function AdminWorkspacePage() {
    const { workspaceId } = Route.useParams()

    return <AdminWorkspace workspaceId={workspaceId as Workspace.Id} />
}
