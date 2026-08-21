import { useState, type ReactNode } from 'react'
import { AlertDialog, Button, Spinner } from '@pretzel-graph/standard-ui/foundations'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import { DialogSDK } from '@pretzel-graph/standard-ui/SDKs/DialogSDK'
import { NotificationSDK } from '@pretzel-graph/standard-ui/SDKs/NotificationSDK'
import { Fleet } from '@pretzel-cloud/shared/domain'
import type { Workspace } from '@pretzel-cloud/shared/domain'
import { WorkspaceSDK } from '../../sdk'
import { StatusBadge } from '../status'

type Action = Fleet.Machine.LifecycleAction

const REBUILD_CONFIRM_ID = 'rebuild-workspace'

// Raw state-machine controls are for developing the fleet, not for users. Gated
// on the origin: `localhost` is a reserved TLD that no deployment can serve, so
// production can never accidentally ship these enabled.
const DEV_CONTROLS =
    typeof location !== 'undefined' &&
    (location.hostname === 'localhost' || location.hostname.endsWith('.localhost'))

const PLANS: { plan: Workspace.Plan; label: string; machines: string }[] = [
    { plan: 'free', label: 'Free', machines: '1 machine'  },
    { plan: 'pro',  label: 'Pro',  machines: '2 machines' },
]

const DEV_ACTIONS: { action: Action; label: string; icon: ReactNode }[] = [
    { action: 'start',   label: 'Start',   icon: <SystemIcons.Play /> },
    { action: 'stop',    label: 'Stop',    icon: <SystemIcons.Square /> },
    { action: 'suspend', label: 'Suspend', icon: <SystemIcons.Pause /> },
    { action: 'resume',  label: 'Resume',  icon: <SystemIcons.Zap /> },
]

// The SDK has a method per action; the map is only what the buttons render.
const CALL: Record<Action, (workspaceId: Workspace.Id) => Promise<unknown>> = {
    start:   WorkspaceSDK.actions.start,
    stop:    WorkspaceSDK.actions.stop,
    suspend: WorkspaceSDK.actions.suspend,
    resume:  WorkspaceSDK.actions.resume,
    restart: WorkspaceSDK.actions.restart,
}

export const LifecycleSettings = ({ workspaceId }: { workspaceId: Workspace.Id; dialogId: string }) => {
    const workspace = WorkspaceSDK.useStore((s) => s.workspaces[workspaceId])

    const [busy, setBusy] = useState<Action | null>(null)

    const [converting, setConverting] = useState<Workspace.Plan | null>(null)

    const [rebuilding, setRebuilding] = useState(false)

    if (!workspace) return null

    const run = (action: Action) => async () => {
        setBusy(action)

        try {
            await CALL[action](workspaceId)

            NotificationSDK.toast.success(`${action[0].toUpperCase()}${action.slice(1)} done`)
        }
        catch {
            NotificationSDK.toast.error(`Could not ${action} the workspace`)
        }
        finally {
            setBusy(null)
        }
    }

    const convert = (plan: Workspace.Plan) => async () => {
        setConverting(plan)

        try {
            await WorkspaceSDK.actions.setPlan(workspaceId, plan)

            NotificationSDK.toast.success(`Rebuilt on the ${plan} topology`)
        }
        catch {
            NotificationSDK.toast.error('Could not change the topology')
        }
        finally {
            setConverting(null)
        }
    }

    const rebuild = () => {
        DialogSDK.actions.push(REBUILD_CONFIRM_ID, (props) => (
            <DialogSDK.AlertTemplate
                {...props}
                type="danger"
                approveLabel="Rebuild"
                onCancel={() => DialogSDK.actions.pop(REBUILD_CONFIRM_ID)}
                onApprove={async () => {
                    DialogSDK.actions.pop(REBUILD_CONFIRM_ID)

                    setRebuilding(true)

                    try {
                        await WorkspaceSDK.actions.rebuild(workspaceId)

                        NotificationSDK.toast.success('Machines rebuilt')
                    }
                    catch {
                        NotificationSDK.toast.error('Could not rebuild the machines')
                    }
                    finally {
                        setRebuilding(false)
                    }
                }}
            >
                <AlertDialog.Title>Rebuild {workspace.displayName}?</AlertDialog.Title>
                <AlertDialog.Description>
                    The machines are replaced with new ones built from the current configuration.
                    The workspace is offline while it runs, and anything executing is stopped. Its
                    database, address and credentials are untouched.
                </AlertDialog.Description>
            </DialogSDK.AlertTemplate>
        ))
    }

    return (
        <div className="flex flex-col gap-4 pr-2">
            <div className="flex items-center justify-between rounded-lg ">
                <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium">Status</p>
                    <p className="text-muted-foreground text-xs">The workspace's current machine state.</p>
                </div>

                <StatusBadge workspace={workspace} />
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

            <div className="flex flex-col gap-3 rounded-lg">
                <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium">Rebuild machines</p>
                    <p className="text-muted-foreground text-xs">
                        Replaces the machines with new ones built from the current configuration.
                        Picks up a new version. The database is untouched.
                    </p>
                </div>

                <Button
                    variant="outline"
                    size="sm"
                    className="mr-auto"
                    disabled={rebuilding || busy !== null}
                    onClick={rebuild}
                >
                    {rebuilding ? <Spinner className="size-3.5" /> : <SystemIcons.Server />}
                    Rebuild machines
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

            {DEV_CONTROLS && (
                <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-4">
                    <div className="flex flex-col gap-1">
                        <p className="text-sm font-medium">Topology</p>
                        <p className="text-muted-foreground text-xs">
                            The plan decides how many machines back this workspace: free runs one
                            combined machine, paid splits the backend and the worker. Changing it
                            rebuilds the machines — the database is untouched.
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {PLANS.map(({ plan, label, machines }) => (
                            <Button
                                key={plan}
                                variant={workspace.plan === plan ? 'default' : 'input'}
                                size="sm"
                                disabled={converting !== null || workspace.plan === plan}
                                onClick={convert(plan)}
                            >
                                {converting === plan ? <Spinner className="size-3.5" /> : <SystemIcons.Server />}
                                {label}
                                <span className="text-muted-foreground text-[10px]">{machines}</span>
                            </Button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
