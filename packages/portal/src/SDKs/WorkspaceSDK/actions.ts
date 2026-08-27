import { Workspace } from '@pretzel-cloud/shared/domain'
import { NotificationSDK } from '@pretzel-graph/standard-ui/SDKs/NotificationSDK'
import { api } from '../api'
import type { WorkspaceSDKImpl } from './sdk'

export type _WorkspaceSDKActions_ = {
    list:         () => Promise<Record<Workspace.Id, Workspace>>
    create:       (payload: Workspace.API.Create.Request) => Promise<Workspace>
    refresh:      (workspaceId: Workspace.Id) => Promise<Workspace>
    rename:       (workspaceId: Workspace.Id, payload: Workspace.API.Rename.Request) => Promise<void>
    setSubdomain: (workspaceId: Workspace.Id, payload: Workspace.API.SetSubdomain.Request) => Promise<void>
    destroy:      (workspaceId: Workspace.Id) => Promise<void>
    start:        (workspaceId: Workspace.Id) => Promise<void>
    stop:         (workspaceId: Workspace.Id) => Promise<void>
    suspend:      (workspaceId: Workspace.Id) => Promise<void>
    restart:      (workspaceId: Workspace.Id) => Promise<void>
    rebuild:      (workspaceId: Workspace.Id) => Promise<void>
    setPlan:      (workspaceId: Workspace.Id, plan: Workspace.Plan) => Promise<Workspace>
    applyEvent:   (event: Workspace.Event.Any) => void
}

export function createWorkspaceSDKActions(sdk: WorkspaceSDKImpl): _WorkspaceSDKActions_ {
    const setState = sdk.useStore.setState

    const merge = (workspace: Workspace) => {
        setState((s) => {
            s.workspaces[workspace.id] = workspace

            delete s.transitions[workspace.id]
            delete s.rebuilding[workspace.id]
        })
    }

    return {
        list: async () => {
            const { workspaces } = await Workspace.API.list(api)

            const byId = Object.fromEntries(workspaces.map((w) => [w.id, w])) as Record<Workspace.Id, Workspace>

            setState((s) => {
                // Replaced, not merged: a workspace someone removed elsewhere
                // has to disappear from the grid.
                s.workspaces = byId
                // The rows just read are authoritative; anything believed to be
                // in flight was settled by an event this client may have missed.
                s.transitions = {}
                s.rebuilding = {}
            })

            return byId
        },

        create: async (payload) => {
            const { workspace } = await Workspace.API.create(api, payload)

            merge(workspace)

            return workspace
        },

        refresh: async (workspaceId) => {
            const { workspace } = await Workspace.API.get(api, workspaceId)

            merge(workspace)

            return workspace
        },

        rename: async (workspaceId, payload) => {
            await Workspace.API.rename(api, workspaceId, payload)

            setState((s) => {
                const card = s.workspaces[workspaceId]

                if (card) card.displayName = payload.displayName
            })
        },

        setSubdomain: async (workspaceId, payload) => {
            await Workspace.API.setSubdomain(api, workspaceId, payload)

            setState((s) => {
                const card = s.workspaces[workspaceId]

                if (card) card.subdomain = payload.subdomain
            })
        },

        destroy: async (workspaceId) => {
            await Workspace.API.destroy(api, workspaceId)

            setState((s) => {
                delete s.workspaces[workspaceId]
            })
        },

        // Accepted, not done: the request returns before the machine has moved,
        // and what it settles on arrives as an event. Reading the card here
        // would only find the state it is on its way out of.
        start:   async (workspaceId) => { await Workspace.API.start(api, workspaceId)   },
        stop:    async (workspaceId) => { await Workspace.API.stop(api, workspaceId)    },
        suspend: async (workspaceId) => { await Workspace.API.suspend(api, workspaceId) },
        restart: async (workspaceId) => { await Workspace.API.restart(api, workspaceId) },
        rebuild: async (workspaceId) => { await Workspace.API.rebuild(api, workspaceId) },

        // The plan decides the topology, so the machines are rebuilt behind
        // this — re-read rather than patching the plan in place.
        setPlan: async (workspaceId, plan) => {
            await Workspace.API.setPlan(api, workspaceId, { plan })

            return sdk.actions.refresh(workspaceId)
        },

        // Patched in place rather than re-fetched: the event already carries the
        // field that moved. An event for a card this client never loaded is
        // dropped — the list decides what is on screen.
        applyEvent: (event) => {
            setState((s) => {
                if (event.type === 'destroyed') {
                    delete s.workspaces[event.workspaceId]
                    delete s.transitions[event.workspaceId]
                    delete s.rebuilding[event.workspaceId]

                    return
                }

                const card = s.workspaces[event.workspaceId]

                if (!card)
                    return

                // Held only until the machine reports what it settled on.
                if (event.type === 'transition:started')
                    s.transitions[event.workspaceId] = event.action

                // Cleared here too: the state that follows is the one it was
                // already in, so nothing else would take the card out of it.
                if (event.type === 'transition:failed') {
                    delete s.transitions[event.workspaceId]

                    NotificationSDK.toast.error(`Could not ${event.action} ${card.displayName}`, { description: event.reason })
                }

                if (event.type === 'lifecycle:changed') {
                    card.lifecycleState = event.lifecycleState

                    delete s.transitions[event.workspaceId]
                }

                // Held for the whole rebuild, since the stop and start it runs
                // report nothing of their own.
                if (event.type === 'rebuild:started')
                    s.rebuilding[event.workspaceId] = true

                if (event.type === 'rebuilt') {
                    delete s.rebuilding[event.workspaceId]

                    NotificationSDK.toast.success(`${card.displayName} rebuilt`)
                }

                if (event.type === 'rebuild:failed') {
                    delete s.rebuilding[event.workspaceId]

                    NotificationSDK.toast.error(`Could not rebuild ${card.displayName}`, { description: event.reason })
                }

                if (event.type === 'plan:changed')
                    card.plan = event.plan
            })
        },
    }
}
