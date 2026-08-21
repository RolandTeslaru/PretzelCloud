import type { ReactNode } from 'react'
import { Badge, Spinner } from '@pretzel-graph/standard-ui/foundations'
import type { BadgeProps } from '@pretzel-graph/standard-ui/foundations'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import type { Fleet, Workspace } from '@pretzel-cloud/shared/domain'
import { WorkspaceSDK } from '../sdk'

// Keyed by the enums, so adding a state or an action fails to compile until it
// is given an appearance here.
type Appearance = { label: string; variant: BadgeProps['variant']; icon: ReactNode }

const spinner = <Spinner className="size-2.5" />

/**
 * What a transition is called while it runs, and where it is heading. The
 * spinner already says it is in motion, so the colour names the state it will
 * settle on rather than the one it is leaving. None of these is a machine state.
 */
const IN_FLIGHT: Record<Fleet.Machine.LifecycleAction, Omit<Appearance, 'icon'>> = {
    start:   { label: 'Starting',   variant: 'success' },
    stop:    { label: 'Stopping',   variant: 'destructive' },
    suspend: { label: 'Suspending', variant: 'destructive' },
    resume:  { label: 'Resuming',   variant: 'success' },
    restart: { label: 'Restarting', variant: 'success' },
}

/**
 * The card shows one badge, but three things move behind it: whether the
 * workspace is built (its status), whether something is happening to its machine
 * right now (the transition), and what that machine last settled on (its state).
 *
 * Being built wins over everything, and a transition in flight wins over the
 * state it is on its way out of.
 */
export const displayStatus = (
    workspace:  Workspace,
    transition?: Fleet.Machine.LifecycleAction,
): Appearance => {
    if (workspace.provisioningStatus === 'provisioning')
        return { label: 'Provisioning', variant: 'secondary', icon: spinner }

    if (workspace.provisioningStatus === 'failed')
        return { label: 'Failed', variant: 'destructive', icon: <SystemIcons.AlertTriangle /> }

    if (transition)
        return { ...IN_FLIGHT[transition], icon: spinner }

    switch (workspace.state) {
        case 'running':   return { label: 'Running',   variant: 'success', icon: <SystemIcons.Check /> }
        case 'suspended': return { label: 'Suspended', variant: "destructive", icon: <SystemIcons.Moon /> }
        case 'stopped':   return { label: 'Stopped',   variant: "destructive", icon: <SystemIcons.Power /> }
        case 'creating':  return { label: 'Starting',  variant: 'active', icon: spinner }
        default:          return { label: 'Ready',     variant: 'success', icon: <SystemIcons.Check /> }
    }
}

/**
 * Whether the workspace can be opened. Only a machine that is up answers, so a
 * card is a link exactly while its badge says Running.
 */
export const isReachable = (
    workspace:   Workspace,
    transition?: Fleet.Machine.LifecycleAction,
) =>
    workspace.provisioningStatus === 'ready'
    && workspace.state === 'running'
    && !transition

/** Reads the transition itself, so only the badge re-renders when one starts. */
export const StatusBadge = ({ workspace }: { workspace: Workspace }) => {
    const transition = WorkspaceSDK.useStore((s) => s.transitions[workspace.id])

    const { label, variant, icon } = displayStatus(workspace, transition)

    return (
        <Badge variant={variant} size="sm">
            {icon}
            {label}
        </Badge>
    )
}
