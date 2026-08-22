import { Badge, Button, Spinner } from '@pretzel-graph/standard-ui/foundations'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import { Billing, type Workspace } from '@pretzel-cloud/shared/domain'
import { BillingSDK } from '@/SDKs/BillingSDK'
import { WorkspaceSDK } from '../../sdk'

export const PlanSettings = ({ workspaceId }: { workspaceId: Workspace.Id; dialogId: string }) => {
    const workspace = WorkspaceSDK.useStore((s) => s.workspaces[workspaceId])

    const busy = BillingSDK.useStore((s) => s.pending)

    if (!workspace) return null

    const subscribed = workspace.plan !== 'free'

    return (
        <div className="flex flex-col gap-4 pr-2">
            <div className="flex flex-col gap-1">
                <p className="text-muted-foreground text-xs">
                    What this workspace runs on. Changing it rebuilds its machines; everything it
                    holds is kept.
                </p>
            </div>

            <div className="flex flex-col gap-3">
                {Billing.OFFERS.map(({ plan, label, price, blurb }) => {
                    const current = workspace.plan === plan

                    return (
                        <div key={plan} className="flex items-center justify-between gap-4 py-1">
                            <div className="flex flex-col gap-0.5">
                                <div className="flex items-center gap-2">
                                    <p className="text-sm font-medium">{label}</p>
                                    <span className="text-muted-foreground text-xs">{price}/month</span>
                                    {current && (
                                        <Badge variant="success" size="xs">Current</Badge>
                                    )}
                                </div>
                                <p className="text-muted-foreground text-xs">{blurb}</p>
                            </div>

                            {!current && plan !== 'free' && (
                                <Button size="sm" variant="input" disabled={busy !== null} onClick={() => BillingSDK.actions.changePlan(workspaceId, plan)}>
                                    {busy === plan ? <Spinner className="size-3.5" /> : <SystemIcons.Receipt />}
                                    Choose
                                </Button>
                            )}
                        </div>
                    )
                })}
            </div>

            {subscribed && (
                <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                        <p className="text-sm font-medium">Subscription</p>
                        <p className="text-muted-foreground text-xs">
                            Cards, invoices and cancellation are handled by the payment provider.
                        </p>
                    </div>

                    <Button
                        variant="outline"
                        size="sm"
                        className="mr-auto"
                        disabled={busy !== null}
                        onClick={() => BillingSDK.actions.openBillingPortal()}
                    >
                        {busy === 'portal' ? <Spinner className="size-3.5" /> : <SystemIcons.ExternalLink />}
                        Manage subscription
                    </Button>
                </div>
            )}
        </div>
    )
}
