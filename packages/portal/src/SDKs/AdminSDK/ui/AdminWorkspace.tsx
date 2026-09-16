import type { ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Workspace } from '@pretzel-cloud/shared/domain'
import { Tabs } from '@pretzel-graph/standard-ui/foundations'
import { WorkspaceUsage } from '../../EntitlementSDK/ui/WorkspaceUsage'
import { DatabaseStatistic } from '../../WorkspaceSDK/ui/WorkspacesGrid/DatabaseStatistic'
import { MachineStatistic } from '../../WorkspaceSDK/ui/WorkspacesGrid/MachineStatistic'
import { StatusBadge } from '../../WorkspaceSDK/ui/StatusBadge'
import { getMessageFromError } from '../../api'
import { AdminSDK } from '../sdk'
import { AdminWorkspaceActions } from './AdminWorkspaceActions'

const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
    <div className="space-y-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="text-sm break-all">{children}</div>
    </div>
)

/** One workspace, whoever owns it. */
export const AdminWorkspace = ({ workspaceId }: { workspaceId: Workspace.Id }) => {
    const [detail, [query]] = AdminSDK.use(
        (s) => s.details[workspaceId],
        [AdminSDK.query.workspace(workspaceId)],
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

    return (
        <section className="space-y-8 px-3 pt-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1">
                    <div className="flex items-center gap-3">
                        <h2 className="text-lg font-semibold">{workspace.displayName}</h2>
                        <StatusBadge workspace={workspace} />
                    </div>
                    <p className="font-mono text-xs text-muted-foreground">{workspace.id}</p>
                    {workspace.disabledReason && <p className="text-sm text-destructive">{workspace.disabledReason}</p>}
                </div>

                <AdminWorkspaceActions summary={{ workspace, owner }} onDeleted={() => void navigate({ to: '/admin/workspaces' })} />
            </div>

            <Tabs.Root defaultValue="general" className="gap-4">
                <Tabs.List size="sm" className="w-fit mr-auto justify-start overflow-x-auto">
                    <Tabs.Trigger value="general">General</Tabs.Trigger>
                    <Tabs.Trigger value="usage">Execution usage</Tabs.Trigger>
                    <Tabs.Trigger value="hardware">Hardware</Tabs.Trigger>
                    <Tabs.Trigger value="members">Members ({members.length})</Tabs.Trigger>
                </Tabs.List>

                <Tabs.Content value="general">
                    <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
                        <Fact label="Owner">
                            <p>{owner.displayName}</p>
                            <p className="text-xs text-muted-foreground">{owner.email}</p>
                        </Fact>
                        <Fact label="Plan">{workspace.plan.displayName}</Fact>
                        <Fact label="Subscription">
                            {workspace.subscriptionStatus ?? 'none'}
                            {workspace.currentPeriodEnd && <p className="text-xs text-muted-foreground">renews {workspace.currentPeriodEnd.toLocaleDateString()}</p>}
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

                <Tabs.Content value="usage">
                    <WorkspaceUsage workspace={workspace} actions={AdminSDK.actions.usage} initialReport={usage} showWorkspaceName={false} />
                </Tabs.Content>

                <Tabs.Content value="hardware">
                    {hardwareStatistics ? (
                        <div className="space-y-3">
                            {hardwareStatistics.databaseSizeBytes !== null && <DatabaseStatistic databaseSizeBytes={hardwareStatistics.databaseSizeBytes} />}
                            {machines.map(([machineId, statistics]) => <MachineStatistic key={machineId} machineStatistics={statistics} />)}
                            <p className="text-xs text-muted-foreground">Captured {hardwareStatistics.capturedAt.toLocaleString()}</p>
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground">No readings while the machines are down.</p>
                    )}
                </Tabs.Content>

                <Tabs.Content value="members">
                    <div className="space-y-2">
                        {members.map((member) => (
                            <div key={member.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                                <span>{member.displayName}</span>
                                <span className="text-xs text-muted-foreground break-all">{member.email}</span>
                                {member.id === owner.id && <span className="text-xs text-muted-foreground">owner</span>}
                            </div>
                        ))}
                    </div>
                </Tabs.Content>
            </Tabs.Root>
        </section>
    )
}
