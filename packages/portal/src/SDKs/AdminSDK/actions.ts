import { Admin, User, Workspace } from '@pretzel-cloud/shared/domain'
import { api } from '../api'
import type { AdminSDKImpl } from './sdk'

export type _AdminSDKActions_ = {
    workspaces: {
        list:    () => Promise<Admin.WorkspaceSummary[]>
        destroy: (workspaceId: Workspace.Id, confirmation: string) => Promise<void>
    }
    users: {
        list:   () => Promise<Admin.UserSummary[]>
        delete: (userId: User.Id, confirmation: string) => Promise<void>
    }
}

export function createAdminSDKActions(sdk: AdminSDKImpl): _AdminSDKActions_ {
    const setState = sdk.useStore.setState

    return {
        workspaces: {
            list: async () => {
                const { workspaces } = await Admin.API.list(api)

                setState((s) => {
                    s.workspaces = workspaces
                })

                return workspaces
            },

            destroy: async (workspaceId, confirmation) => {
                await Admin.API.destroy(api, workspaceId, { confirmation })

                setState((s) => {
                    const destroyed = s.workspaces.find((summary) => summary.workspace.id === workspaceId)

                    s.workspaces = s.workspaces.filter((summary) => summary.workspace.id !== workspaceId)

                    const owner = s.users.find((user) => user.id === destroyed?.owner.id)

                    if (owner)
                        owner.ownedWorkspaceCount -= 1
                })
            },
        },

        users: {
            list: async () => {
                const { users } = await Admin.API.Users.list(api)

                setState((s) => {
                    s.users = users
                })

                return users
            },

            // Their owned workspaces are deleted with them, so those rows go too.
            delete: async (userId, confirmation) => {
                await Admin.API.Users.remove(api, userId, { confirmation })

                setState((s) => {
                    s.users = s.users.filter((user) => user.id !== userId)

                    s.workspaces = s.workspaces.filter((summary) => summary.owner.id !== userId)
                })
            },
        },
    }
}
