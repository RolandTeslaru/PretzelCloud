import { Admin, User, Workspace } from '@pretzel-cloud/shared/domain'
import { NotificationSDK } from '@pretzel-graph/standard-ui/SDKs/NotificationSDK'
import { api, getMessageFromError } from '../api'
import type { AdminSDKImpl } from './sdk'

export type _AdminSDKActions_ = {
    workspaces: {
        list:      () => Promise<Record<Workspace.Id, Admin.WorkspaceSummary>>
        get:       (workspaceId: Workspace.Id) => Promise<Admin.WorkspaceDetail>
        lifecycle: (workspaceId: Workspace.Id, action: Workspace.Lifecycle.Action) => Promise<void>
        destroy:   (workspaceId: Workspace.Id, confirmation: string) => Promise<void>
    }
    usage: {
        listUsage:      (workspaceId: Workspace.Id, window: Workspace.Usage.Window) => Promise<Workspace.Usage[]>
        getUsageReport: (workspaceId: Workspace.Id) => Promise<Workspace.Usage.Report>
        getUsageSeries: (workspaceId: Workspace.Id) => Promise<Workspace.Usage.Point[]>
    }
    users: {
        list:   () => Promise<Record<User.Id, Admin.UserSummary>>
        delete: (userId: User.Id, confirmation: string) => Promise<void>
    }
}

export function createAdminSDKActions(sdk: AdminSDKImpl): _AdminSDKActions_ {
    const setState = sdk.useStore.setState

    return {
        workspaces: {
            list: async () => {
                const { workspaces } = await Admin.API.list(api)

                const workspacesById = Object.fromEntries(workspaces.map((summary) => [summary.workspace.id, summary])) as Record<Workspace.Id, Admin.WorkspaceSummary>

                setState((s) => {
                    s.workspaces = workspacesById
                })

                return workspacesById
            },

            get: async (workspaceId) => {
                const detail = await Admin.API.get(api, workspaceId)

                setState((s) => {
                    s.details[workspaceId] = detail
                })

                return detail
            },

            lifecycle: async (workspaceId, action) => {
                const workspace = sdk.state.workspaces[workspaceId]?.workspace ?? sdk.state.details[workspaceId]?.workspace

                try {
                    await Admin.API.lifecycle(api, workspaceId, action)

                    NotificationSDK.toast.success(`${workspace?.displayName ?? workspaceId}: ${action} requested`)
                }
                catch (error) {
                    NotificationSDK.toast.error(getMessageFromError(error, `Could not ${action} the workspace`))
                }
            },

            destroy: async (workspaceId, confirmation) => {
                await Admin.API.destroy(api, workspaceId, { confirmation })

                setState((s) => {
                    const destroyed = s.workspaces[workspaceId]

                    delete s.workspaces[workspaceId]

                    delete s.details[workspaceId]

                    const owner = destroyed ? s.users[destroyed.owner.id] : undefined

                    if (owner)
                        owner.ownedWorkspaceCount -= 1
                })
            },
        },

        usage: {
            listUsage: async (workspaceId, window) => {
                const { records } = await Admin.API.Usage.list(api, workspaceId, window)

                return records
            },

            getUsageReport: (workspaceId) => Admin.API.Usage.getReport(api, workspaceId),

            getUsageSeries: async (workspaceId) => {
                const { points } = await Admin.API.Usage.getSeries(api, workspaceId)

                return points
            },
        },

        users: {
            list: async () => {
                const { users } = await Admin.API.Users.list(api)

                const usersById = Object.fromEntries(users.map((user) => [user.id, user])) as Record<User.Id, Admin.UserSummary>

                setState((s) => {
                    s.users = usersById
                })

                return usersById
            },

            // Their owned workspaces are deleted with them, so those rows go too.
            delete: async (userId, confirmation) => {
                await Admin.API.Users.remove(api, userId, { confirmation })

                setState((s) => {
                    delete s.users[userId]

                    for (const summary of Object.values(s.workspaces).filter((row) => row.owner.id === userId)) {
                        delete s.details[summary.workspace.id]

                        delete s.workspaces[summary.workspace.id]
                    }
                })
            },
        },
    }
}
