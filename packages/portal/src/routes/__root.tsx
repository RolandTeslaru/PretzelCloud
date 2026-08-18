import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { DialogSDK } from '@pretzel-graph/standard-ui/SDKs/DialogSDK'
import type { AuthSDK } from '@/SDKs/AuthSDK/sdk'

interface RouterContext {
    auth: AuthSDK.State
}

const queryClient = new QueryClient()

export const Route = createRootRouteWithContext<RouterContext>()({
    component: () => (
        <QueryClientProvider client={queryClient}>
            <Toaster position="bottom-right" />
            <DialogSDK.UIOverlay />
            <Outlet />
        </QueryClientProvider>
    ),
})
