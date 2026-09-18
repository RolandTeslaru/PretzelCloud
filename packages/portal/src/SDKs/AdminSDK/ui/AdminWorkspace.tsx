import type { ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Plan, Workspace } from '@pretzel-cloud/shared/domain'
import { Button, DropdownMenu, Tabs } from '@pretzel-graph/standard-ui/foundations'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import { WorkspaceUsage } from '../../EntitlementSDK/ui/WorkspaceUsage'
import { StatusBadge } from '../../WorkspaceSDK/ui/StatusBadge'
import { ROLE_ICON } from '../../WorkspaceSDK/ui/WorkspacesGrid/MachineStatistic'
import { getMessageFromError } from '../../api'
import { AdminSDK } from '../sdk'
import { AdminWorkspaceActions } from './AdminWorkspaceActions'
import { AdminWorkspaceMembers } from './AdminWorkspaceMembers'

const Fact = ({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) => (
    <div className="space-y-1">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}</p>
        <div className="text-sm break-all">{children}</div>
    </div>
)

const toMegabytes = (bytes: number) => `${Math.round(bytes / 1024 ** 2)} MB`

const STRIPE_TERMINAL_STATUSES = ['canceled', 'incomplete_expired']

/** One workspace, whoever owns it. */
export const AdminWorkspace = ({ workspaceId }: { workspaceId: Workspace.Id }) => {
    const [{ detail, plansById }, [query]] = AdminSDK.useWith(
        (s) => ({ detail: s.details[workspaceId], plansById: s.plans }),
        [AdminSDK.query.workspace(workspaceId), AdminSDK.query.plansList],
    )

    const { error, isPending } = query

    const navigate = useNavigate()

    if (error && !detail)
        return (
            <p role="alert" className="px-3 pt-4 text-sm text-destructive">
                {getMessageFromError(error, 'Could not load this workspace.')}
            </p>
        )

    if (!detail)
        return <p role="status" className="px-3 py-12 text-center text-sm text-muted-foreground">{isPending ? 'Loading workspace…' : 'This workspace is gone.'}</p>

    const { workspace, owner, members, usage, hardwareStatistics } = detail

    const machines = Object.entries(hardwareStatistics?.machines ?? {})

    const stripeControlsPlan = workspace.subscriptionStatus !== null
        && !STRIPE_TERMINAL_STATUSES.includes(workspace.subscriptionStatus)

    const canSetPlan = workspace.lifecycleState !== 'disabled' && !stripeControlsPlan

    return (
        <section className="space-y-8 px-3 pt-4">

            <Tabs.Root defaultValue="general" className="gap-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-1">
                        <div className="flex items-center gap-3">
                            <h2 className="text-lg font-semibold">{workspace.displayName}</h2>
                            <StatusBadge workspace={workspace} />
                        </div>
                        {workspace.disabledReason && <p className="text-sm text-destructive">{workspace.disabledReason}</p>}
                    </div>

                    <Tabs.List size="sm" className="w-fit ml-auto justify-start overflow-x-auto">
                        <Tabs.Trigger value="general">General</Tabs.Trigger>
                        <Tabs.Trigger value="plan">Plan and billing</Tabs.Trigger>
                        <Tabs.Trigger value="usage">Execution usage</Tabs.Trigger>
                        <Tabs.Trigger value="hardware">Hardware</Tabs.Trigger>
                        <Tabs.Trigger value="members">Members ({members.length})</Tabs.Trigger>
                    </Tabs.List>
                    <AdminWorkspaceActions summary={{ workspace, owner }} onDeleted={() => void navigate({ to: '/admin/workspaces' })} />
                </div>

                <Tabs.Content value="general">
                    <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
                        <Fact label="Workspace ID">
                            <span className="font-mono text-xs">{workspace.id}</span>
                        </Fact>
                        <Fact label="Owner">
                            <p>{owner.displayName}</p>
                            <p className="text-xs text-muted-foreground">{owner.email}</p>
                        </Fact>
                        <Fact label="Region">{workspace.region ?? '—'}</Fact>
                        <Fact label="Release">{workspace.releaseName ?? '—'}</Fact>
                        <Fact label="Created">{workspace.createdAt.toLocaleDateString()}</Fact>
                        <Fact label="Subdomain">{workspace.subdomain ?? '—'}</Fact>
                        <Fact label="App">
                            <a href={workspace.appUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">{workspace.appUrl}</a>
                        </Fact>
                    </div>
                </Tabs.Content>

                <Tabs.Content value="plan">
                    <div className="divide-y divide-border/60">
                        <section className="space-y-4 pb-6">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h3 className="text-sm font-medium">Plan</h3>
                                    <p className="text-xs text-muted-foreground">{workspace.plan.description}</p>
                                    {!canSetPlan && (
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {workspace.lifecycleState === 'disabled'
                                                ? 'Enable this workspace before changing its plan.'
                                                : `Stripe controls this plan while the subscription is ${workspace.subscriptionStatus}.`}
                                        </p>
                                    )}
                                </div>

                                <DropdownMenu.Root>
                                    <DropdownMenu.Trigger asChild>
                                        <Button variant="input" size="sm" disabled={!canSetPlan || Object.keys(plansById).length === 0}>
                                            <SystemIcons.Receipt /> Set plan
                                        </Button>
                                    </DropdownMenu.Trigger>
                                    <DropdownMenu.Content align="end">
                                        {Object.values(plansById).map((plan) => (
                                            <DropdownMenu.Item
                                                key={plan.id}
                                                disabled={plan.id === workspace.plan.id}
                                                onSelect={() => AdminSDK.dialogs.openSetPlan(workspace, plan)}
                                            >
                                                <span className="flex-1">{plan.displayName}</span>
                                                <span className="text-xs text-muted-foreground">{Plan.getPriceLabel(plan)}</span>
                                            </DropdownMenu.Item>
                                        ))}
                                    </DropdownMenu.Content>
                                </DropdownMenu.Root>
                            </div>

                            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
                                <Fact label="Name">{workspace.plan.displayName}</Fact>
                                <Fact label="Plan ID"><span className="font-mono text-xs">{workspace.plan.id}</span></Fact>
                                <Fact label="Listed price">{Plan.getPriceLabel(workspace.plan)}/month</Fact>
                                <Fact label="Purchasable">{workspace.plan.purchasable ? 'Yes' : 'No'}</Fact>
                            </div>
                        </section>

                        <section className="space-y-4 py-6">
                            <h3 className="text-sm font-medium">Billing</h3>

                            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
                                <Fact label="Subscription status">{workspace.subscriptionStatus ?? 'None'}</Fact>
                                <Fact label="Current period starts">{workspace.currentPeriodStart?.toLocaleDateString() ?? '—'}</Fact>
                                <Fact label="Current period ends">{workspace.currentPeriodEnd?.toLocaleDateString() ?? '—'}</Fact>
                                <Fact label="Stripe product ID"><span className="font-mono text-xs">{workspace.plan.stripeProductId ?? '—'}</span></Fact>
                                <Fact label="Stripe price ID"><span className="font-mono text-xs">{workspace.plan.stripePriceId ?? '—'}</span></Fact>
                            </div>
                        </section>

                        <section className="space-y-4 py-6">
                            <h3 className="text-sm font-medium">Machines</h3>

                            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
                                <Fact label="Backend size"><span className="font-mono text-xs">{workspace.plan.backendSize}</span></Fact>
                                <Fact label="Workers">{Plan.isCombined(workspace.plan) ? 'None, runs on the backend' : workspace.plan.workerCount.toLocaleString()}</Fact>
                                <Fact label="Worker size"><span className="font-mono text-xs">{workspace.plan.workerSize ?? '—'}</span></Fact>
                                <Fact label="Executions per worker">{workspace.plan.workerConcurrency.toLocaleString()}</Fact>
                                <Fact label="Idle backend policy">{workspace.plan.idleBackendPolicy}</Fact>
                            </div>
                        </section>

                        <section className="space-y-4 pt-6">
                            <h3 className="text-sm font-medium">Limits</h3>

                            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
                                <Fact label="Execution concurrency">{Plan.getExecutionConcurrency(workspace.plan).toLocaleString()}</Fact>
                                <Fact label="Monthly executions">{workspace.plan.maxExecutionsMonthly?.toLocaleString() ?? 'Unlimited'}</Fact>
                                <Fact label="Monthly uptime">{workspace.plan.maxUptimeHoursMonthly === null ? 'Unlimited' : `${workspace.plan.maxUptimeHoursMonthly.toLocaleString()} hours`}</Fact>
                                <Fact label="Workflows">{workspace.plan.maxWorkflows?.toLocaleString() ?? 'Unlimited'}</Fact>
                                <Fact label="Workspace members">{workspace.plan.maxWorkspaceMembers?.toLocaleString() ?? 'Unlimited'}</Fact>
                                <Fact label="Execution session retention">{workspace.plan.executionSessionRetentionDays === null ? 'Indefinite' : `${workspace.plan.executionSessionRetentionDays.toLocaleString()} days`}</Fact>
                            </div>
                        </section>
                    </div>
                </Tabs.Content>

                <Tabs.Content value="usage">
                    <WorkspaceUsage workspace={workspace} actions={AdminSDK.actions.usage} initialReport={usage} showWorkspaceName={false} />
                </Tabs.Content>

                <Tabs.Content value="hardware">
                    {hardwareStatistics ? (
                        <div className="space-y-6">
                            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
                                <Fact label="Database size" icon={<SystemIcons.Database className="size-3.5" />}>
                                    {hardwareStatistics.databaseSizeBytes !== null ? toMegabytes(hardwareStatistics.databaseSizeBytes) : '—'}
                                </Fact>
                                <Fact label="Captured">{hardwareStatistics.capturedAt.toLocaleString()}</Fact>
                            </div>

                            {machines.map(([machineId, machine]) => {
                                const RoleIcon = ROLE_ICON[machine.role]

                                return (
                                    <div key={machineId} className="space-y-3">
                                        <div className="flex items-center gap-2">
                                            <RoleIcon className="size-4 text-muted-foreground" />
                                            <p className="text-sm font-medium capitalize">{machine.role} machine</p>
                                        </div>

                                        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
                                            <Fact label="Machine">
                                                <p className="font-mono text-xs">{machineId}</p>
                                            </Fact>
                                            <Fact label="State">{machine.state}</Fact>
                                            <Fact label="CPU">{machine.cpuPercent !== null ? `${Math.round(machine.cpuPercent)}%` : '—'}</Fact>
                                            <Fact label="Memory">
                                                {machine.memUsedBytes !== null && machine.memTotalBytes !== null ? (
                                                    <>
                                                        <p>{Math.round(machine.memUsedBytes / machine.memTotalBytes * 100)}%</p>
                                                        <p className="text-xs text-muted-foreground">{toMegabytes(machine.memUsedBytes)} of {toMegabytes(machine.memTotalBytes)}</p>
                                                    </>
                                                ) : '—'}
                                            </Fact>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground">No readings while the machines are down.</p>
                    )}
                </Tabs.Content>

                <Tabs.Content value="members">
                    <AdminWorkspaceMembers members={members} ownerId={owner.id} />
                </Tabs.Content>
            </Tabs.Root>
        </section>
    )
}
