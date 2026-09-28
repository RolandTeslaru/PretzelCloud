import type { ComponentType } from 'react'
import { createFileRoute, Link, Outlet, redirect, useMatches, useRouterState } from '@tanstack/react-router'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import type { BaseIconProps } from '@pretzel-graph/standard-ui/icons/baseIcon'
import { PretzelGraphDropdown } from '@/components/PretzelGraphDropdown'
import { WorkspaceSDK } from '@/SDKs/WorkspaceSDK'
import { AuthSDK } from '@/SDKs/AuthSDK'

// What a page beneath this layout may declare about itself.
declare module '@tanstack/react-router' {
    interface StaticDataRouteOption {
        title?: string
    }
}

/**
 * The signed-in shell: sidebar, title bar, and whatever page is beneath it.
 *
 * Pathless — the leading underscore means it wraps its children without adding a
 * segment, so these pages keep their own addresses and the landing page at `/`
 * stays outside it entirely.
 */
export const Route = createFileRoute('/_app')({
    // One guard for everything inside, rather than one per page.
    beforeLoad: ({ context }) => {
        if (!context.auth.isAuthenticated) {
            throw redirect({ to: '/auth' })
        }
    },
    // Warms the plans for the pages beneath without holding the shell back.
    loader: () => {
        void WorkspaceSDK.prefetch(WorkspaceSDK.query.plansList)

        return null
    },
    component: AppLayout,
})

function AppLayout() {
    const matches = useMatches()

    // The deepest match that names itself wins, so a nested page can override
    // the section it sits in.
    const title = [...matches].reverse().find((m) => m.staticData?.title)?.staticData?.title

    return (
        <div className="w-fit relative z-10 flex flex-row bg-background/80 max-w-7xl w-full backdrop-blur-lg max-h-screen rounded-tr-2xl min-h-screen mr-auto">

            <Sidebar />
            
            <div className='relative w-full'>
                <nav className="absolute z-20 top-0 min-h-[60px] px-4 flex items-center">
                    <h1 className="text-xl font-semibold">{title}</h1>
                </nav>
                <div className="flex flex-col relative w-full max-h-screen overflow-hidden">
                    <main className="flex-1 pt-[60px] min-h-0 w-full overflow-y-auto pl-3 pr-10 pt-6 pb-10 [mask-image:linear-gradient(to_bottom,transparent_8px,black_72px)]">
                        <Outlet />
                    </main>
                </div>
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
    { id: 'workspaces', label: 'Workspaces', to: '/', icon: SystemIcons.Server },
    { id: 'usage', label: 'Usage', to: '/usage', icon: SystemIcons.ChartNoAxesCombined },
    { id: 'billing', label: 'Billing', to: '/billing', icon: SystemIcons.Receipt },
]

const NAV_ADMIN: NavEntry[] = [
    { id: 'admin-workspaces', label: 'All workspaces', to: '/admin/workspaces', icon: SystemIcons.Server },
    { id: 'admin-users', label: 'All users', to: '/admin/users', icon: SystemIcons.Users },
    { id: 'admin-listings', label: 'All listings', to: '/admin/listings', icon: SystemIcons.Globe },
]

const Sidebar = () => {
    const isAdmin = AuthSDK.useStore((s) => s.user?.isAdmin ?? false)

    return (
        <aside className="w-56 shrink-0 flex flex-col">
            <div className="h-14 px-4 flex items-center">
                <PretzelGraphDropdown title="PretzelCloud" />
            </div>

            <nav className="flex-1 p-2 flex flex-col gap-0.5">
                {NAV_TOP.map((e) => <NavItem key={e.id} entry={e} />)}
                {isAdmin && (
                    <>
                        <p className="px-2 pt-4 pb-1 text-xs text-muted-foreground">Admin</p>
                        {NAV_ADMIN.map((e) => <NavItem key={e.id} entry={e} />)}
                    </>
                )}
            </nav>
        </aside>
    )
}

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
