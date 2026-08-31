import { Plan, Workspace } from '@pretzel-cloud/shared/domain'
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
    /** Moves the workspace to the newest release; the rebuild events narrate it. */
    update:       (workspaceId: Workspace.Id) => Promise<void>
    setPlan:      (workspaceId: Workspace.Id, planId: Plan.Id) => Promise<Workspace>
    applyEvent:   (event: Workspace.Event.Any) => void
    /** The catalogue. Which plan a workspace is on it carries itself. */
    plans: {
        list:   () => Promise<Record<Plan.Id, Plan>>
        /** A plan the fleet already holds, put where the pages that render it look. */
        upsert: (plan: Plan) => void
    }
}

export function createWorkspaceSDKActions(sdk: WorkspaceSDKImpl): _WorkspaceSDKActions_ {
    const setState = sdk.useStore.setState

    const upsert = (workspace: Workspace) => {
        setState((s) => {
            s.workspaces[workspace.id] = workspace

            delete s.transitions[workspace.id]
            delete s.rebuilding[workspace.id]
            delete s.provisioning[workspace.id]
        })
    }

    return {
        list: async () => {
            const { workspaces, hardwareStatistics } = await Workspace.API.list(api, { getHardwareStatistics: true })

            const workspacesById = Object.fromEntries(workspaces.map((workspace) => [workspace.id, workspace])) as Record<Workspace.Id, Workspace>

            setState((s) => {
                s.workspaces = workspacesById
                s.transitions = {}
                s.rebuilding = {}
                s.provisioning = {}
                s.hardwareStatistics = hardwareStatistics ?? {}
            })

            return workspacesById
        },

        create: async (payload) => {
            const { workspace } = await Workspace.API.create(api, payload)

            upsert(workspace)

            return workspace
        },

        refresh: async (workspaceId) => {
            const { workspace } = await Workspace.API.get(api, workspaceId)

            upsert(workspace)

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

        update: async (workspaceId) => { await Workspace.API.update(api, workspaceId) },

        // The plan decides the topology, so the machines are rebuilt behind
        // this — re-read rather than patching the plan in place.
        setPlan: async (workspaceId, planId) => {
            await Workspace.API.setPlan(api, workspaceId, { planId })

            return sdk.actions.refresh(workspaceId)
        },

        plans: {
            list: async () => {
                const { plans } = await Plan.API.list(api)

                const plansById = Object.fromEntries(plans.map((plan) => [plan.id, plan])) as Record<Plan.Id, Plan>

                setState((s) => {
                    // Replaced, not merged: a plan withdrawn from sale has to
                    // disappear from the pages that offer it.
                    s.plans = plansById
                })

                return plansById
            },

            upsert: (plan) => {
                setState((s) => {
                    s.plans[plan.id] = plan
                })
            },
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
                    delete s.provisioning[event.workspaceId]
                    delete s.hardwareStatistics[event.workspaceId]

                    return
                }

                const card = s.workspaces[event.workspaceId]

                if (!card)
                    return

                switch (event.type) {

                    case 'transition:started':
                        s.transitions[event.workspaceId] = event.action

                        break

                    case 'transition:failed':
                        delete s.transitions[event.workspaceId]

                        NotificationSDK.toast.error(`Could not ${event.action} ${card.displayName}`, { description: event.reason })

                        break

                    case 'lifecycle:changed':
                        card.lifecycleState = event.lifecycleState

                        delete s.transitions[event.workspaceId]
                        delete s.provisioning[event.workspaceId]
                        // Readings from before the change describe machines that no longer run that way.
                        delete s.hardwareStatistics[event.workspaceId]

                        break

                    case 'hardware:statistics':
                        s.hardwareStatistics[event.workspaceId] = event.statistics

                        break

                    case 'provisioning:step':
                        s.provisioning[event.workspaceId] = event.step

                        break

                    case 'provisioning:step:failed':
                        delete s.provisioning[event.workspaceId]

                        NotificationSDK.toast.error(`Could not provision ${card.displayName}`, { description: `Failed at the ${event.step} stage` })

                        break

                    case 'rebuild:started':
                        s.rebuilding[event.workspaceId] = true

                        break

                    case 'rebuild:succeeded':
                        delete s.rebuilding[event.workspaceId]

                        NotificationSDK.toast.success(`${card.displayName} rebuilt`)

                        break

                    case 'rebuild:failed':
                        delete s.rebuilding[event.workspaceId]

                        NotificationSDK.toast.error(`Could not rebuild ${card.displayName}`, { description: event.reason })

                        break

                    case 'plan:changed':
                        card.plan = event.plan

                        s.plans[event.plan.id] = event.plan

                        break
                }
            })
        },
    }
}
