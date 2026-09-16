import { createFileRoute } from '@tanstack/react-router'
import { Button, Spinner } from '@pretzel-graph/standard-ui/foundations'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import { BillingSDK } from '@/SDKs/BillingSDK'
import { WorkspaceSDK } from '@/SDKs/WorkspaceSDK/sdk'
import { WorkspacesBillingTable } from '@/SDKs/BillingSDK/ui/WorkspacesBillingTable'

export const Route = createFileRoute('/_app/billing')({
    loader: async () => {
        await WorkspaceSDK.fetch(WorkspaceSDK.query.workspacesList).catch(() => null)

        return null
    },
    staticData: { title: 'Billing' },
    component: BillingPage,
})

function BillingPage() {
    const opening = BillingSDK.useStore((s) => s.pending === 'portal')

    return (
        <div className="flex flex-col gap-8">
            <section className="flex flex-row gap-3 w-full ">
                <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium">Payment method and invoices</p>
                    <p className="text-muted-foreground text-xs">
                        Cards, receipts and cancellation are handled by the payment provider.
                    </p>
                </div>

                <Button variant="input" size="sm" className="ml-auto" disabled={opening} onClick={() => BillingSDK.actions.openBillingPortal()}>
                    {opening ? <Spinner className="size-3.5" /> : <SystemIcons.ExternalLink />}
                    Open billing portal
                </Button>
            </section>

            <section className="flex flex-col gap-3">
                <WorkspacesBillingTable />
            </section>
        </div>
    )
}
