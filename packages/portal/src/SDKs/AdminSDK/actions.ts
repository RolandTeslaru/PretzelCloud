import { Admin, type Listing, type Plan, type Template, User, Workspace } from '@pretzel-cloud/shared/domain'
import { NotificationSDK } from '@pretzel-graph/standard-ui/SDKs/NotificationSDK'
import { api, getMessageFromError } from '../api'
import type { AdminSDKImpl } from './sdk'

export type _AdminSDKActions_ = {
    workspaces: {
        list:      () => Promise<Record<Workspace.Id, Admin.WorkspaceSummary>>
        get:       (workspaceId: Workspace.Id) => Promise<Admin.WorkspaceDetail>
        lifecycle: (workspaceId: Workspace.Id, action: Workspace.Lifecycle.Action) => Promise<void>
        disable:   (workspaceId: Workspace.Id, reason: string) => Promise<void>
        enable:    (workspaceId: Workspace.Id) => Promise<void>
        setPlan:   (workspaceId: Workspace.Id, plan: Plan) => Promise<void>
        destroy:   (workspaceId: Workspace.Id, confirmation: string) => Promise<void>
    }
    usage: {
        listUsage:      (workspaceId: Workspace.Id, window: Workspace.Usage.Window) => Promise<Workspace.Usage[]>
        getUsageReport: (workspaceId: Workspace.Id) => Promise<Workspace.Usage.Report>
        getUsageSeries: (workspaceId: Workspace.Id) => Promise<Workspace.Usage.Point[]>
    }
    plans: {
        list: () => Promise<Record<Plan.Id, Plan>>
    }
    users: {
        list:   () => Promise<Record<User.Id, Admin.UserSummary>>
        delete: (userId: User.Id, confirmation: string) => Promise<void>
    }
    listings: {
        list:              () => Promise<Record<Listing.Id, Admin.ListingSummary>>
        setTemplate:       (listingId: Listing.Id, template: Template.API.Set.Request) => Promise<void>
        removeTemplate:    (listingId: Listing.Id) => Promise<void>
        setShelfBlueprint: (listingId: Listing.Id, blueprintId: string) => Promise<void>
        removeFromShelf:   (listingId: Listing.Id) => Promise<void>
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

            disable: async (workspaceId, reason) => {
                const workspace = sdk.state.workspaces[workspaceId]?.workspace ?? sdk.state.details[workspaceId]?.workspace

                try {
                    await Admin.API.disable(api, workspaceId, { reason })

                    setState((s) => {
                        const summary = s.workspaces[workspaceId]
                        const detail = s.details[workspaceId]

                        if (summary) {
                            summary.workspace.lifecycleState = 'disabled'
                            summary.workspace.disabledReason = reason
                        }

                        if (detail) {
                            detail.workspace.lifecycleState = 'disabled'
                            detail.workspace.disabledReason = reason
                        }
                    })

                    NotificationSDK.toast.success(`${workspace?.displayName ?? workspaceId} disabled`)
                }
                catch (error) {
                    NotificationSDK.toast.error(getMessageFromError(error, 'Could not disable the workspace'))
                }
            },

            enable: async (workspaceId) => {
                const workspace = sdk.state.workspaces[workspaceId]?.workspace ?? sdk.state.details[workspaceId]?.workspace

                try {
                    await Admin.API.enable(api, workspaceId)

                    setState((s) => {
                        const summary = s.workspaces[workspaceId]
                        const detail = s.details[workspaceId]

                        if (summary) {
                            summary.workspace.lifecycleState = 'sleeping'
                            summary.workspace.disabledReason = null
                        }

                        if (detail) {
                            detail.workspace.lifecycleState = 'sleeping'
                            detail.workspace.disabledReason = null
                        }
                    })

                    NotificationSDK.toast.success(`${workspace?.displayName ?? workspaceId} enabled`)
                }
                catch (error) {
                    NotificationSDK.toast.error(getMessageFromError(error, 'Could not enable the workspace'))
                }
            },

            setPlan: async (workspaceId, plan) => {
                const workspace = sdk.state.workspaces[workspaceId]?.workspace ?? sdk.state.details[workspaceId]?.workspace

                try {
                    await Admin.API.setPlan(api, workspaceId, { planId: plan.id })

                    setState((s) => {
                        const summary = s.workspaces[workspaceId]
                        const detail = s.details[workspaceId]

                        if (summary)
                            summary.workspace.plan = plan

                        if (detail)
                            detail.workspace.plan = plan
                    })

                    NotificationSDK.toast.success(`${workspace?.displayName ?? workspaceId}: plan change requested`)
                }
                catch (error) {
                    NotificationSDK.toast.error(getMessageFromError(error, 'Could not change the workspace plan'))
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

        plans: {
            list: async () => {
                const { plans } = await Admin.API.Plans.list(api)

                const plansById = Object.fromEntries(plans.map((plan) => [plan.id, plan])) as Record<Plan.Id, Plan>

                setState((s) => { s.plans = plansById })

                return plansById
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

        listings: {
            list: async () => {
                const { listings } = await Admin.API.Listings.list(api)

                const listingsById = Object.fromEntries(listings.map((listing) => [listing.id, listing])) as Record<Listing.Id, Admin.ListingSummary>

                setState((s) => {
                    s.listings = listingsById
                })

                return listingsById
            },

            setTemplate: async (listingId, template) => {
                const name = sdk.state.listings[listingId]?.name ?? listingId

                try {
                    await Admin.API.Templates.set(api, listingId, template)

                    setState((s) => {
                        const listing = s.listings[listingId]

                        if (listing)
                            listing.template = template
                    })

                    NotificationSDK.toast.success(`${name} is a template`)
                }
                catch (error) {
                    NotificationSDK.toast.error(getMessageFromError(error, 'Could not mark the listing as a template'))
                }
            },

            removeTemplate: async (listingId) => {
                const name = sdk.state.listings[listingId]?.name ?? listingId

                try {
                    await Admin.API.Templates.remove(api, listingId)

                    setState((s) => {
                        const listing = s.listings[listingId]

                        if (listing)
                            listing.template = null
                    })

                    NotificationSDK.toast.success(`${name} is no longer a template`)
                }
                catch (error) {
                    NotificationSDK.toast.error(getMessageFromError(error, 'Could not remove the template'))
                }
            },

            setShelfBlueprint: async (listingId, blueprintId) => {
                const name = sdk.state.listings[listingId]?.name ?? listingId

                try {
                    await Admin.API.Shelf.add(api, listingId, { blueprintId })

                    setState((s) => {
                        const listing = s.listings[listingId]

                        if (listing)
                            listing.blueprintId = blueprintId
                    })

                    NotificationSDK.toast.success(`${name} is on the extended shelf`)
                }
                catch (error) {
                    NotificationSDK.toast.error(getMessageFromError(error, 'Could not add the listing to the extended shelf'))
                }
            },

            removeFromShelf: async (listingId) => {
                const name = sdk.state.listings[listingId]?.name ?? listingId

                try {
                    await Admin.API.Shelf.remove(api, listingId)

                    setState((s) => {
                        const listing = s.listings[listingId]

                        if (listing)
                            listing.blueprintId = null
                    })

                    NotificationSDK.toast.success(`${name} is off the extended shelf`)
                }
                catch (error) {
                    NotificationSDK.toast.error(getMessageFromError(error, 'Could not remove the listing from the extended shelf'))
                }
            },
        },
    }
}
