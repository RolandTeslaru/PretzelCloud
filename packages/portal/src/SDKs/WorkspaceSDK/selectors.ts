import { Workspace } from '@pretzel-cloud/shared/domain'
import type { User } from '@pretzel-cloud/shared/domain'
import type { WorkspaceSDK } from './sdk'

export interface WorkspaceSDKSelectors {
    /** Ownership is account-level standing, and the row already carries it. */
    ownedBy: (state: WorkspaceSDK.State, userId: User.Id) => Workspace[]
    /**
     * Name search and ordering over what is already loaded — never a round
     * trip. An empty query is everything.
     */
    matching: (state: WorkspaceSDK.State, query: string, sort?: WorkspaceSDK.Sort) => Workspace[]
    count: (state: WorkspaceSDK.State) => number
    /** One status for the badge: the lifecycle, or whatever is moving it right now. */
    displayStatus: (state: WorkspaceSDK.State, workspace: Workspace) => WorkspaceSDK.DisplayStatus
    /** Whether the workspace can be opened: it accepts traffic and nothing is moving it. */
    isReachable: (state: WorkspaceSDK.State, workspace: Workspace) => boolean
}

/** What the control plane itself lists them by. */
export const DEFAULT_SORT: WorkspaceSDK.Sort = { field: 'created', direction: 'desc' }

const compare: Record<WorkspaceSDK.SortField, (a: Workspace, b: Workspace) => number> = {
    name:    (a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }),
    created: (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
}

const ordered = (workspaces: Workspace[], sort: WorkspaceSDK.Sort) => {
    const sign = sort.direction === 'asc' ? 1 : -1

    return workspaces.sort((a, b) => sign * compare[sort.field](a, b))
}

export const workspaceSelectors: WorkspaceSDKSelectors = {
    ownedBy: (s, userId) => ordered(
        Object.values(s.workspaces).filter((w) => w.ownerId === userId),
        DEFAULT_SORT,
    ),

    matching: (s, query, sort = DEFAULT_SORT) => {
        const needle = query.trim().toLowerCase()

        const found = needle
            ? Object.values(s.workspaces).filter((w) => w.displayName.toLowerCase().includes(needle))
            : Object.values(s.workspaces)

        return ordered(found, sort)
    },

    count: (s) => Object.keys(s.workspaces).length,

    displayStatus: (s, workspace) => {
        if (s.destroying[workspace.id])
            return 'destroying'

        // Being built or having failed to build wins over anything in flight.
        if (workspace.lifecycleState === 'creating' || workspace.lifecycleState === 'provisioning_failed')
            return workspace.lifecycleState

        // A rebuild runs a stop and a start inside it, so it wins over the transition.
        if (s.rebuilding[workspace.id])
            return 'rebuilding'

        if (s.updating[workspace.id] !== undefined)
            return 'updating'

        return s.transitions[workspace.id] ?? workspace.lifecycleState
    },

    isReachable: (s, workspace) =>
        Workspace.Lifecycle.acceptsTraffic(workspace.lifecycleState)
        && !s.transitions[workspace.id]
        && !s.rebuilding[workspace.id]
        && s.updating[workspace.id] === undefined
        && !s.destroying[workspace.id],
}
