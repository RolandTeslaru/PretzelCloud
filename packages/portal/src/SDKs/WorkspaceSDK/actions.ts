import { Fleet, Workspace } from '@pretzel-cloud/shared/domain'
import { api } from '../api'
import type { WorkspaceSDKImpl } from './sdk'

export type _WorkspaceSDKActions_ = {
    list:         () => Promise<Record<Workspace.Id, Workspace>>
    create:       (payload: Workspace.API.Create.Request) => Promise<Workspace>
    refresh:      (workspaceId: Workspace.Id) => Promise<Workspace>
    rename:       (workspaceId: Workspace.Id, payload: Workspace.API.Rename.Request) => Promise<void>
    setSubdomain: (workspaceId: Workspace.Id, payload: Workspace.API.SetSubdomain.Request) => Promise<void>
    destroy:      (workspaceId: Workspace.Id) => Promise<void>
    start:        (workspaceId: Workspace.Id) => Promise<Workspace>
    stop:         (workspaceId: Workspace.Id) => Promise<Workspace>
    suspend:      (workspaceId: Workspace.Id) => Promise<Workspace>
    restart:      (workspaceId: Workspace.Id) => Promise<Workspace>
    rebuild:      (workspaceId: Workspace.Id) => Promise<Workspace>
    setPlan:      (workspaceId: Workspace.Id, plan: Workspace.Plan) => Promise<Workspace>
    applyEvent:   (event: Workspace.Event.Any) => void
}

export function createWorkspaceSDKActions(sdk: WorkspaceSDKImpl): _WorkspaceSDKActions_ {
    const setState = sdk.useStore.setState

    const merge = (workspace: Workspace) => {
        setState((s) => {
            s.workspaces[workspace.id] = workspace

            delete s.transitions[workspace.id]
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

        // The transition changes machine state, which the workspace's status
        // reflects — so re-read the card rather than guessing the new value.
        start:   async (workspaceId) => { await Workspace.API.start(api, workspaceId);   return sdk.actions.refresh(workspaceId) },
        stop:    async (workspaceId) => { await Workspace.API.stop(api, workspaceId);    return sdk.actions.refresh(workspaceId) },
        suspend: async (workspaceId) => { await Workspace.API.suspend(api, workspaceId); return sdk.actions.refresh(workspaceId) },
        restart: async (workspaceId) => { await Workspace.API.restart(api, workspaceId); return sdk.actions.refresh(workspaceId) },
        rebuild: async (workspaceId) => { await Workspace.API.rebuild(api, workspaceId); return sdk.actions.refresh(workspaceId) },

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

                    return
                }

                const card = s.workspaces[event.workspaceId]

                if (!card)
                    return

                // Held only until the machine reports what it settled on.
                if (event.type === 'transition:started')
                    s.transitions[event.workspaceId] = event.action

                if (event.type === 'lifecycle:changed') {
                    card.lifecycleState = event.lifecycleState

                    delete s.transitions[event.workspaceId]
                }

                if (event.type === 'plan:changed')
                    card.plan = event.plan
            })
        },
    }
}
