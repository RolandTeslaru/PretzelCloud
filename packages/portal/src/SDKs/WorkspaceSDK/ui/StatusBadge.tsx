import type { ReactNode } from 'react'
import { Badge, Spinner } from '@pretzel-graph/standard-ui/foundations'
import type { BadgeProps } from '@pretzel-graph/standard-ui/foundations'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import { Plan } from '@pretzel-cloud/shared/domain'
import type { Workspace } from '@pretzel-cloud/shared/domain'
import { WorkspaceSDK } from '../sdk'

// Keyed by the enums, so adding a state or an action fails to compile until it
// is given an appearance here.
type Appearance = { label: string; variant: BadgeProps['variant']; icon: ReactNode }

const spinner = <Spinner className="size-2.5" />

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

/**
 * A transition in flight is named for where it is heading: the spinner already
 * says it is in motion, so the colour names the state it will settle on.
 */
const APPEARANCE: Record<WorkspaceSDK.DisplayStatus, Appearance> = {
    destroying:          { label: 'Destroying',   variant: 'destructive', icon: spinner },
    rebuilding:          { label: 'Rebuilding',   variant: 'secondary',   icon: spinner },
    updating:            { label: 'Updating',     variant: 'secondary',   icon: spinner },
    start:               { label: 'Starting',     variant: 'success',     icon: spinner },
    stop:                { label: 'Stopping',     variant: 'destructive', icon: spinner },
    suspend:             { label: 'Sleeping',     variant: 'nightly',     icon: spinner },
    restart:             { label: 'Restarting',   variant: 'success',     icon: spinner },
    creating:            { label: 'Provisioning', variant: 'secondary',   icon: spinner },
    provisioning_failed: { label: 'Failed',       variant: 'destructive', icon: <SystemIcons.AlertTriangle /> },
    running:             { label: 'Running',      variant: 'success',     icon: <SystemIcons.Check /> },
    sleeping:            { label: 'Sleeping',     variant: 'nightly',     icon: <SystemIcons.Moon /> },
    stopped:             { label: 'Stopped',      variant: 'destructive', icon: <SystemIcons.Power /> },
    disabled:            { label: 'Disabled',     variant: 'destructive', icon: <SystemIcons.AlertTriangle /> },
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

export const StatusBadge = ({ workspace }: { workspace: Workspace }) => {

    const status = WorkspaceSDK.useStore((s) => s.selectors.displayStatus(s, workspace))

    const { label, variant, icon } = APPEARANCE[status]

    return (
        <Badge variant={variant} size="sm">
            {icon}
            {label}
        </Badge>
    )
}
