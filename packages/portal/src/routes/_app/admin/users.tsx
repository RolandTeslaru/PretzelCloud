import { createFileRoute } from '@tanstack/react-router'
import { AdminSDK } from '@/SDKs/AdminSDK'
import { AdminUsers } from '@/SDKs/AdminSDK/ui/AdminUsers'

export const Route = createFileRoute('/_app/admin/users')({
    loader: () => {
        void AdminSDK.prefetch(AdminSDK.query.usersList)

        return null
    },
    staticData: { title: 'All users' },
    component: AdminUsers,
})
