import { Badge, Button, Spinner } from '@pretzel-graph/standard-ui/foundations'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import { Plan, type Workspace } from '@pretzel-cloud/shared/domain'
import { BillingSDK } from '@/SDKs/BillingSDK'
import { WorkspaceSDK } from '../../sdk'

export const PlanSettings = ({ workspaceId }: { workspaceId: Workspace.Id; dialogId: string }) => {
    const workspace = WorkspaceSDK.useStore((s) => s.workspaces[workspaceId])

    const busy = BillingSDK.useStore((s) => s.pending)

    const plansById = WorkspaceSDK.useStore((s) => s.plans)

    if (!workspace) return null

    const isPaidPlan = Plan.isPaid(workspace.plan)

    return (
        <div className="flex flex-col gap-4 pr-2">
            <div className="flex flex-col gap-1">
                <p className="text-muted-foreground text-xs">
                    What this workspace runs on. Changing it rebuilds its machines; everything it
                    holds is kept.
                </p>
            </div>

            <div className="flex flex-col gap-3">
                {Object.values(plansById).map((plan) => {
                    const current = workspace.plan.id === plan.id

                    return (
                        <div key={plan.id} className="flex items-center justify-between gap-4 py-1">
                            <div className="flex flex-col gap-0.5">
                                <div className="flex items-center gap-2">
                                    <p className="text-sm font-medium">{plan.displayName}</p>
                                    <span className="text-muted-foreground text-xs">{Plan.getPriceLabel(plan)}/month</span>
                                    {current && (
                                        <Badge variant="success" size="xs">Current</Badge>
                                    )}
                                </div>
                                <p className="text-muted-foreground text-xs">{plan.description}</p>
                            </div>

                            {!current && Plan.isPaid(plan) && (
                                <Button size="sm" variant="input" disabled={busy !== null} onClick={() => BillingSDK.actions.changePlan(workspaceId, plan.id)}>
                                    {busy === plan.id ? <Spinner className="size-3.5" /> : <SystemIcons.Receipt />}
                                    Choose
                                </Button>
                            )}
                        </div>
                    )
                })}
            </div>

            {isPaidPlan && (
                <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                        <p className="text-sm font-medium">Subscription</p>
                        <p className="text-muted-foreground text-xs">
                            Cards, invoices and cancellation are handled by the payment provider.
                        </p>
                    </div>

                    <Button
                        variant="input"
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
