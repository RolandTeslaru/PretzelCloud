import { useState, type ReactNode } from 'react'
import { Badge, Button, Spinner } from '@pretzel-graph/standard-ui/foundations'
import type { BadgeProps } from '@pretzel-graph/standard-ui/foundations'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import { NotificationSDK } from '@pretzel-graph/standard-ui/SDKs/NotificationSDK'
import { Fleet } from '@pretzel-cloud/shared/domain'
import type { Workspace } from '@pretzel-cloud/shared/domain'
import { WorkspaceSDK } from '../../sdk'

type Action = Fleet.Machine.LifecycleAction

// Raw state-machine controls are for developing the fleet, not for users. Gated
// on the origin: `localhost` is a reserved TLD that no deployment can serve, so
// production can never accidentally ship these enabled.
const DEV_CONTROLS =
    typeof location !== 'undefined' &&
    (location.hostname === 'localhost' || location.hostname.endsWith('.localhost'))

type Appearance = { label: string; variant: BadgeProps['variant']; icon: ReactNode }

const displayStatus = (workspace: Workspace): Appearance => {
    if (workspace.provisioningStatus === 'provisioning')
        return { label: 'Provisioning', variant: 'secondary', icon: <Spinner className="size-2.5" /> }

    if (workspace.provisioningStatus === 'failed')
        return { label: 'Failed', variant: 'destructive', icon: <SystemIcons.AlertTriangle /> }

    switch (workspace.state) {
        case 'running':   return { label: 'Running',   variant: 'success', icon: <SystemIcons.Check /> }
        case 'suspended': return { label: 'Suspended', variant: 'outline', icon: <SystemIcons.Moon /> }
        case 'stopped':   return { label: 'Stopped',   variant: 'outline', icon: <SystemIcons.Power /> }
        case 'creating':  return { label: 'Starting',  variant: 'secondary', icon: <Spinner className="size-2.5" /> }
        default:          return { label: 'Ready',     variant: 'success', icon: <SystemIcons.Check /> }
    }
}

const DEV_ACTIONS: { action: Action; label: string; icon: ReactNode }[] = [
    { action: 'start',   label: 'Start',   icon: <SystemIcons.Play /> },
    { action: 'stop',    label: 'Stop',    icon: <SystemIcons.Square /> },
    { action: 'suspend', label: 'Suspend', icon: <SystemIcons.Pause /> },
    { action: 'resume',  label: 'Resume',  icon: <SystemIcons.Zap /> },
]

export const LifecycleSettings = ({ workspaceId }: { workspaceId: Workspace.Id; dialogId: string }) => {
    const workspace = WorkspaceSDK.useStore((s) => s.workspaces[workspaceId])

    const [busy, setBusy] = useState<Action | null>(null)

    if (!workspace) return null

    const status = displayStatus(workspace)

    const run = (action: Action) => async () => {
        setBusy(action)

        try {
            await WorkspaceSDK.actions.lifecycle(workspaceId, action)

            NotificationSDK.toast.success(`${action[0].toUpperCase()}${action.slice(1)} done`)
        }
        catch {
            NotificationSDK.toast.error(`Could not ${action} the workspace`)
        }
        finally {
            setBusy(null)
        }
    }

    return (
        <div className="flex flex-col gap-4 pr-2">
            <div className="flex items-center justify-between rounded-lg ">
                <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium">Status</p>
                    <p className="text-muted-foreground text-xs">The workspace's current machine state.</p>
                </div>

                <Badge variant={status.variant} size="sm">
                    {status.icon}
                    {status.label}
                </Badge>
            </div>

            <div className="flex flex-col gap-3 rounded-lg">
                <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium">Restart</p>
                    <p className="text-muted-foreground text-xs">
                        Stops the machine and starts it again. Use it when the workspace stops responding.
                    </p>
                </div>

                <Button
                    variant="outline"
                    size="sm"
                    className="mr-auto"
                    disabled={busy !== null}
                    onClick={run('restart')}
                >
                    {busy === 'restart' ? <Spinner className="size-3.5" /> : <SystemIcons.RefreshCcw />}
                    Restart workspace
                </Button>
            </div>

            {DEV_CONTROLS && (
                <div className="flex flex-col gap-3 rounded-lg ">
                    <div className="flex flex-col gap-1">
                        <p className="text-sm font-medium">Machine controls</p>
                        <p className="text-muted-foreground text-xs">
                            Raw state-machine transitions. Development only — the platform drives these
                            automatically in production.
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {DEV_ACTIONS.map(({ action, label, icon }) => (
                            <Button
                                key={action}
                                variant="input"
                                size="sm"
                                disabled={busy !== null}
                                onClick={run(action)}
                            >
                                {busy === action ? <Spinner className="size-3.5" /> : icon}
                                {label}
                            </Button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
