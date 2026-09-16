import type { ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Workspace } from '@pretzel-cloud/shared/domain'
import { Tabs } from '@pretzel-graph/standard-ui/foundations'
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

/** One workspace, whoever owns it. */
export const AdminWorkspace = ({ workspaceId }: { workspaceId: Workspace.Id }) => {
    const [detail, [query]] = AdminSDK.useWith(
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
