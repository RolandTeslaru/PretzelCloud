import type { ReactNode } from 'react'
import { Admin, Workspace } from '@pretzel-cloud/shared/domain'
import { Button, DropdownMenu } from '@pretzel-graph/standard-ui/foundations'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import { AdminSDK } from '../sdk'

const LIFECYCLE_ACTIONS: { action: Workspace.Lifecycle.Action; label: string; icon: ReactNode }[] = [
    { action: 'start',   label: 'Start',   icon: <SystemIcons.Play /> },
    { action: 'stop',    label: 'Stop',    icon: <SystemIcons.Square /> },
    { action: 'suspend', label: 'Suspend', icon: <SystemIcons.Pause /> },
    { action: 'restart', label: 'Restart', icon: <SystemIcons.RefreshCcw /> },
]

export const AdminWorkspaceActions = ({ summary, onDeleted }: {
    summary: Admin.WorkspaceSummary
    onDeleted?: () => void
}) => (
    <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
            <Button variant="input" size="icon-sm" aria-label={`Actions for ${summary.workspace.displayName} owned by ${summary.owner.email}`}>
                <SystemIcons.Ellipsis size={16} />
            </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">
            <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger>
                    <SystemIcons.Power /> Lifecycle
                </DropdownMenu.SubTrigger>
                <DropdownMenu.SubContent>
                    {LIFECYCLE_ACTIONS.map(({ action, label, icon }) => (
                        <DropdownMenu.Item
                            key={action}
                            disabled={summary.workspace.lifecycleState === 'disabled'}
                            onSelect={() => void AdminSDK.actions.workspaces.lifecycle(summary.workspace.id, action)}
                        >
                            {icon} {label}
                        </DropdownMenu.Item>
                    ))}
                </DropdownMenu.SubContent>
            </DropdownMenu.Sub>
            <DropdownMenu.Separator />
            {summary.workspace.lifecycleState === 'disabled' ? (
                <DropdownMenu.Item onSelect={() => void AdminSDK.actions.workspaces.enable(summary.workspace.id)}>
                    <SystemIcons.LockOpen size={14} /> Enable workspace
                </DropdownMenu.Item>
            ) : (
                <DropdownMenu.Item variant="destructive" onSelect={() => AdminSDK.dialogs.openDisableWorkspace(summary)}>
                    <SystemIcons.LockClosed size={14} /> Disable workspace…
                </DropdownMenu.Item>
            )}
            <DropdownMenu.Separator />
            <DropdownMenu.Item variant="destructive" onSelect={() => AdminSDK.dialogs.openDeleteWorkspace(summary, onDeleted)}>
                <SystemIcons.Trash2 size={14} /> Delete workspace
            </DropdownMenu.Item>
        </DropdownMenu.Content>
    </DropdownMenu.Root>
)
