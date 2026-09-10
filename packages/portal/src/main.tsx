import 'reflect-metadata'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import './index.css'
import { SystemSDK } from '@pretzel-graph/standard-ui/SDKs/SystemSDK'
import { AuthSDK } from './SDKs/AuthSDK/sdk'
import { RealtimeSDK, socketUrl } from './SDKs/RealtimeSDK'
import { routeTree } from './routeTree.gen'

SystemSDK.init()

export const router = createRouter({
    routeTree,
    context: {
        auth: undefined!, // passed in the provider
    },
})

// Registered before init so the recovered session counts as a transition.
AuthSDK.subscribe((auth, previous) => {
    if (auth.isAuthenticated === previous.isAuthenticated)
        return

    if (auth.isAuthenticated)
        RealtimeSDK.connect(socketUrl())
    else
        RealtimeSDK.disconnect()

    // The provider re-renders later, so the guards are handed the new state here; on boot it mounts with it.
    if (!previous.isLoading) {
        router.update({ ...router.options, context: { auth } })
        router.invalidate()
    }
})

AuthSDK.init()

declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router
    }
}

function App() {
    const auth = AuthSDK.useStore()

    if (auth.isLoading) {
        return (
            <div className="bg-background text-muted-foreground flex min-h-screen items-center justify-center text-sm">
                Authenticating…
            </div>
        )
    }

    return <RouterProvider router={router} context={{ auth }} />
}

const rootElement = document.getElementById('root')!

if (!rootElement.innerHTML) {
    createRoot(rootElement).render(
        <StrictMode>
            <App />
        </StrictMode>,
    )
}
