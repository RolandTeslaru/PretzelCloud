import { useState, type ReactNode } from 'react'
import { AlertDialog, Button, Spinner } from '@pretzel-graph/standard-ui/foundations'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import { DialogSDK } from '@pretzel-graph/standard-ui/SDKs/DialogSDK'
import { NotificationSDK } from '@pretzel-graph/standard-ui/SDKs/NotificationSDK'
import { Plan, type Workspace } from '@pretzel-cloud/shared/domain'
import { getMessageFromError } from '@/SDKs/api'
import { WorkspaceSDK } from '../../sdk'
import { StatusBadge } from '../status'

type Action = Workspace.Lifecycle.Action

const REBUILD_CONFIRM_ID = 'rebuild-workspace'

// Topology switching bypasses billing, so it stays local. `localhost` is a
// reserved TLD that no deployment can serve.
const DEV_CONTROLS =
    typeof location !== 'undefined' &&
    (location.hostname === 'localhost' || location.hostname.endsWith('.localhost'))


const MACHINE_ACTIONS: { action: Action; label: string; icon: ReactNode }[] = [
    { action: 'start',   label: 'Start',   icon: <SystemIcons.Play /> },
    { action: 'stop',    label: 'Stop',    icon: <SystemIcons.Square /> },
    { action: 'suspend', label: 'Suspend', icon: <SystemIcons.Pause /> },
]

// The SDK has a method per action; the map is only what the buttons render.

export const LifecycleSettings = ({ workspaceId }: { workspaceId: Workspace.Id; dialogId: string }) => {
    const CALL: Record<Action, (workspaceId: Workspace.Id) => Promise<unknown>> = {
        start:   WorkspaceSDK.actions.start,
        stop:    WorkspaceSDK.actions.stop,
        suspend: WorkspaceSDK.actions.suspend,
        restart: WorkspaceSDK.actions.restart,
    }
    const workspace = WorkspaceSDK.useStore((s) => s.workspaces[workspaceId])

    // The request is accepted before the machine moves, so what is in flight is
    // whatever the events say — not how long a call took to return.
    const transition = WorkspaceSDK.useStore((s) => s.transitions[workspaceId])

    const [converting, setConverting] = useState<Plan.Id | null>(null)

    // Held from `rebuild:started` to `rebuild:succeeded`, so it covers the whole of it.
    const rebuilding = WorkspaceSDK.useStore((s) => s.rebuilding[workspaceId])

    const plans = WorkspaceSDK.useStore((s) => s.plans)


    if (!workspace) return null


    // Nothing to report on success: the badge follows the events. Only the
    // request refusing outright goes unannounced otherwise.
    const run = (action: Action) => async () => {
        try {
            await CALL[action](workspaceId)
        }
        catch (error) {
            NotificationSDK.toast.error(getMessageFromError(error, `Could not ${action} the workspace`))
        }
    }

    const convert = (plan: Plan) => async () => {
        setConverting(plan.id)

        try {
            await WorkspaceSDK.actions.setPlan(workspaceId, plan.id)

            NotificationSDK.toast.success(`Rebuilt on the ${plan.displayName} topology`)
        }
        catch (error) {
            NotificationSDK.toast.error(getMessageFromError(error, 'Could not change the topology'))
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

                    try {
                        await WorkspaceSDK.actions.rebuild(workspaceId)
                    }
                    catch (error) {
                        NotificationSDK.toast.error(getMessageFromError(error, 'Could not rebuild the machines'))
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
                    variant="input"
                    size="sm"
                    className="mr-auto"
                    onClick={run('restart')}
                >
                    {transition === 'restart' ? <Spinner className="size-3.5" /> : <SystemIcons.RefreshCcw />}
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
                    variant="input"
                    size="sm"
                    className="mr-auto"
                    onClick={rebuild}
                >
                    {rebuilding ? <Spinner className="size-3.5" /> : <SystemIcons.Server />}
                    Rebuild machines
                </Button>
            </div>

            <div className="flex flex-col gap-3 rounded-lg ">
                <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium">Machine controls</p>
                    <p className="text-muted-foreground text-xs">
                        The platform drives these on its own; a workspace sleeps when idle and wakes
                        on the next request.
                    </p>
                </div>

                <div className="flex flex-wrap gap-2">
                    {MACHINE_ACTIONS.map(({ action, label, icon }) => (
                        <Button
                            key={action}
                            variant="input"
                            size="sm"
                            onClick={run(action)}
                        >
                            {transition === action ? <Spinner className="size-3.5" /> : icon}
                            {label}
                        </Button>
                    ))}
                </div>
            </div>

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
                        {Object.values(plans).map((plan) => (
                            <Button
                                key={plan.id}
                                variant={workspace.plan.id === plan.id ? 'default' : 'input'}
                                size="sm"
                                disabled={converting !== null || workspace.plan.id === plan.id}
                                onClick={convert(plan)}
                            >
                                {converting === plan.id ? <Spinner className="size-3.5" /> : <SystemIcons.Server />}
                                {plan.displayName}
                                <span className="text-muted-foreground text-[10px]">
                                    {Plan.getMachineRoles(plan).length === 1 ? '1 machine' : '2 machines'}
                                </span>
                            </Button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
