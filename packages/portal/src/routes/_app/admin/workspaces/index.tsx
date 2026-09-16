import { createFileRoute } from '@tanstack/react-router'
import { AdminSDK } from '@/SDKs/AdminSDK'
import { AdminWorkspaces } from '@/SDKs/AdminSDK/ui/AdminWorkspaces'

export const Route = createFileRoute('/_app/admin/workspaces/')({
    loader: () => {
        void AdminSDK.prefetch(AdminSDK.query.workspacesList)

        return null
    },
    staticData: { title: 'All workspaces' },
    component: AdminWorkspaces,
})
