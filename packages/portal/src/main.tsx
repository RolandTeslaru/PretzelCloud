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

// The socket follows the session, not the page: the handshake carries a token,
// and signing in or out navigates rather than reloads. Registered before init so
// the session it recovers is itself a transition.
AuthSDK.subscribe((auth, previous) => {
    if (auth.isAuthenticated === previous.isAuthenticated)
        return

    if (auth.isAuthenticated)
        RealtimeSDK.connect(socketUrl())
    else
        RealtimeSDK.disconnect()
})

AuthSDK.init()

export const router = createRouter({
    routeTree,
    context: {
        auth: undefined!, // passed in the provider
    },
})

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
