import { createFileRoute } from '@tanstack/react-router'
import { AdminSDK } from '@/SDKs/AdminSDK'
import { AdminWorkspaces } from '@/SDKs/AdminSDK/ui/AdminWorkspaces'

export const Route = createFileRoute('/_app/admin/workspaces')({
    // Fills the store before the table renders; a failure is left for the table to report.
    loader: async () => {
        await AdminSDK.fetchWorkspaces().catch(() => null)

        return null
    },
    component: AdminWorkspaces,
})
