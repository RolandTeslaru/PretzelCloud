import type { User, Workspace } from '@pretzel-cloud/shared/domain'
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
}
