import type { ReactNode } from 'react'
import { Badge, Spinner } from '@pretzel-graph/standard-ui/foundations'
import type { BadgeProps } from '@pretzel-graph/standard-ui/foundations'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import { Plan, Workspace } from '@pretzel-cloud/shared/domain'
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
const IN_FLIGHT: Record<Workspace.Lifecycle.Action, Omit<Appearance, 'icon'>> = {
    start:   { label: 'Starting',   variant: 'success' },
    stop:    { label: 'Stopping',   variant: 'destructive' },
    suspend: { label: 'Sleeping',   variant: 'nightly' },
    restart: { label: 'Restarting', variant: 'success' },
}

/** What a build is doing right now, named for the stage it is on. */
export const PROVISIONING_STEP: Record<Workspace.Provisioning.Step, string> = {
    hardware:   'Allocating hardware',
    secrets:    'Creating environment',
    machines:   'Building compute',
    owner:      'Setting up account',
    starters:   'Adding starter workflows',
    hostnames:  'Registering hostnames',
    convert:    'Applying plan',
    rebuild:    'Rebuilding',
}

/** One badge for the lifecycle, or for whatever is moving it right now. */
export const displayStatus = (
    workspace:   Workspace,
    transition?: Workspace.Lifecycle.Action,
    rebuilding?: boolean,
): Appearance => {
    const settling = workspace.lifecycleState === 'creating' || workspace.lifecycleState === 'provisioning_failed'

    // Ahead of the transitions: a rebuild runs a stop and a start inside it, and
    // naming those would report the parts rather than the whole.
    if (rebuilding && !settling)
        return { label: 'Rebuilding', variant: 'secondary', icon: spinner }

    // A transition in flight wins over the state it is on its way out of, but
    // not over being built or having failed to build.
    if (transition && !settling)
        return { ...IN_FLIGHT[transition], icon: spinner }

    switch (workspace.lifecycleState) {
        case 'creating':            return { label: 'Provisioning', variant: 'secondary',   icon: spinner }
        case 'provisioning_failed': return { label: 'Failed',       variant: 'destructive', icon: <SystemIcons.AlertTriangle /> }
        case 'running':             return { label: 'Running',      variant: 'success',     icon: <SystemIcons.Check /> }
        case 'sleeping':            return { label: 'Sleeping',     variant: 'nightly',     icon: <SystemIcons.Moon /> }
        case 'updating':            return { label: 'Updating',     variant: 'secondary',   icon: spinner }
        case 'stopped':             return { label: 'Stopped',      variant: 'destructive', icon: <SystemIcons.Power /> }
        case 'disabled':            return { label: 'Disabled',    variant: 'destructive', icon: <SystemIcons.AlertTriangle /> }
    }
}

/**
 * The account's plan, not a state. Free is the default everyone starts on, so it
 * stays quiet and never competes with the status; a paid plan is worth pointing
 * at, and is the one thing on the card the account chose.
 *
 * Named from the plan itself, so a plan written for one customer shows its own
 * name. The id is the fallback until the plans have loaded.
 */
export const PlanBadge = ({ plan }: { plan: Plan }) => (
    <Badge variant={Plan.isPaid(plan) ? 'active' : 'outline'} size="sm">
        {plan.displayName}
    </Badge>
)

/**
 * Whether the workspace can be opened. A sleeping one still answers — the editor
 * shell is served while it boots, and the visit is what wakes it — so only one
 * that will not come up for a visitor, or is already moving, is not a link.
 */
export const isReachable = (
    workspace:   Workspace,
    transition?: Workspace.Lifecycle.Action,
    rebuilding?: boolean,
) =>
    Workspace.Lifecycle.acceptsTraffic(workspace.lifecycleState)
    && !transition
    && !rebuilding

/** Reads the transition itself, so only the badge re-renders when one starts. */
export const StatusBadge = ({ workspace }: { workspace: Workspace }) => {
    const transition = WorkspaceSDK.useStore((s) => s.transitions[workspace.id])

    const rebuilding = WorkspaceSDK.useStore((s) => s.rebuilding[workspace.id])

    const { label, variant, icon } = displayStatus(workspace, transition, rebuilding)

    return (
        <Badge variant={variant} size="sm">
            {icon}
            {label}
        </Badge>
    )
}
