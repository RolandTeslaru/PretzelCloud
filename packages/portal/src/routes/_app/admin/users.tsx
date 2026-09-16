import { createFileRoute } from '@tanstack/react-router'
import { AdminSDK } from '@/SDKs/AdminSDK'
import { AdminUsers } from '@/SDKs/AdminSDK/ui/AdminUsers'

export const Route = createFileRoute('/_app/admin/users')({
    // Fills the store before the table renders; a failure is left for the table to report.
    loader: async () => {
        await AdminSDK.fetchUsers().catch(() => null)

        return null
    },
    staticData: { title: 'All users' },
    component: AdminUsers,
})
