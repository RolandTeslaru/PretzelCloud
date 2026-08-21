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
    lifecycle:    (workspaceId: Workspace.Id, action: Fleet.Machine.LifecycleAction) => Promise<Workspace>
    applyEvent:   (event: Workspace.Event.Any) => void
}

export function createWorkspaceSDKActions(sdk: WorkspaceSDKImpl): _WorkspaceSDKActions_ {
    const setState = sdk.useStore.setState

    const merge = (workspace: Workspace) => {
        setState((s) => {
            s.workspaces[workspace.id] = workspace
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
        lifecycle: async (workspaceId, action) => {
            await Workspace.API.lifecycle(api, workspaceId, { action })

            return sdk.actions.refresh(workspaceId)
        },

        // Patched in place rather than re-fetched: the event already carries the
        // field that moved. An event for a card this client never loaded is
        // dropped — the list decides what is on screen.
        applyEvent: (event) => {
            setState((s) => {
                if (event.type === 'destroyed') {
                    delete s.workspaces[event.workspaceId]

                    return
                }

                const card = s.workspaces[event.workspaceId]

                if (!card)
                    return

                if (event.type === 'state:changed')
                    card.state = event.state

                if (event.type === 'provisioning:changed')
                    card.provisioningStatus = event.provisioningStatus
            })
        },
    }
}
