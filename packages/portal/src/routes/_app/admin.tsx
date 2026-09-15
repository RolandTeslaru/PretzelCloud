import { createFileRoute, redirect } from '@tanstack/react-router'
import { AdminWorkspaces } from '@/components/admin/AdminWorkspaces'

export const Route = createFileRoute('/_app/admin')({
    beforeLoad: ({ context }) => {
        if (!context.auth.user?.isAdmin)
            throw redirect({ to: '/' })
    },
    staticData: { title: 'Admin' },
    component: AdminWorkspaces,
})
