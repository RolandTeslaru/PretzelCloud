import { createFileRoute, Link, redirect, useRouterState } from '@tanstack/react-router'
import { QuerySDK } from '@pretzel-graph/standard-ui/SDKs/QuerySDK/sdk'
import { Button } from '@pretzel-graph/standard-ui/foundations/button'
import { PretzelGraphDropdown } from '@/components/PretzelGraphDropdown'
import { WorkspacesGrid, workspacesQuery } from '@/SDKs/WorkspaceSDK/ui/WorkspacesGrid'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import type { ComponentType } from 'react'
import type { BaseIconProps } from '@pretzel-graph/standard-ui/icons/baseIcon'
import { SearchInput } from '@pretzel-graph/standard-ui/foundations'

export const Route = createFileRoute('/workspaces/')({
    beforeLoad: ({ context }) => {
        if (!context.auth.isAuthenticated) {
            throw redirect({ to: '/auth' })
        }
    },
    // Fills the store before the grid renders. A failure is swallowed so the
    // route still mounts; the grid reports it.
    loader: async () => {
        await QuerySDK.client.fetchQuery(workspacesQuery).catch(() => null)

        return null
    },
    component: Workspaces,
})

function Workspaces() {


    return (

        <div className="w-fit relative z-10 flex flex-row bg-background/80 backdrop-blur-lg max-h-screen rounded-tr-2xl min-h-screen mr-auto">

            <Sidebar />

            <div className="flex flex-col">
                <nav className="min-h-[60px] px-4 flex items-center ">
                    <h1 className="text-xl font-semibold">
                        Workspaces
                    </h1>
                </nav>


                <main className=" pl-3 w-6xl pr-10 pt-6">
                    <WorkspacesGrid />
                </main>
            </div>
        </div>
    )

}

type NavEntry = {
    id: string
    label: string
    to: string
    icon: ComponentType<BaseIconProps>
}

const NAV_TOP: NavEntry[] = [
    { id: 'workspaces', label: 'Workspaces', to: '/workspaces', icon: SystemIcons.Server },
    { id: 'usage', label: 'Usage', to: '/usage', icon: SystemIcons.ChartNoAxesCombined },
    { id: 'billing', label: 'Billing', to: '/billing', icon: SystemIcons.Receipt },
]

export const Sidebar = () => (
    <aside className="w-56 shrink-0 flex flex-col">
        <div className="h-14 px-4 flex items-center">
            <PretzelGraphDropdown />
        </div>

        <nav className="flex-1 p-2 flex flex-col gap-0.5">
            {NAV_TOP.map((e) => <NavItem key={e.id} entry={e} />)}
        </nav>
    </aside>
)

function NavItem({ entry }: { entry: NavEntry }) {
    const pathname = useRouterState({ select: (s) => s.location.pathname })
    const active = pathname === entry.to || pathname.startsWith(entry.to + '/')
    const Icon = entry.icon

    return (
        <Link
            to={entry.to}
            className={[
                'flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors',
                active ? 'bg-muted/80 font-medium' : 'hover:bg-muted/50 opacity-80 hover:opacity-100',
            ].join(' ')}
        >
            <Icon size={16} className={active ? 'stroke-primary' : ''} />
            <span>{entry.label}</span>
        </Link>
    )
}
