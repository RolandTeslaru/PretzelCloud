import { immer } from 'zustand/middleware/immer'
import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import type { Workspace } from '@pretzel-cloud/shared/domain'
import { BaseSDK } from '@pretzel-graph/standard-ui/SDKs/Base'
import { SDK } from '@pretzel-graph/standard-ui/SDKs/SDKManager'
import { createEntitlementSDKActions, type _EntitlementSDKActions_ } from './actions'

export const DEFAULT_WINDOW: Workspace.Usage.Window = 'week'

const STALE_TIME = 30_000

@SDK('Entitlement')
export class EntitlementSDKImpl extends BaseSDK<EntitlementSDK.State> {

    constructor() { super() }

    public readonly useStore: BaseSDK.Store<EntitlementSDK.State> = createWithEqualityFn(
        immer<EntitlementSDK.State>(() => ({
            windows: {},
            reports: {},
            series: {},
            records: {},
        })),
        shallow
    )

    public readonly query = {
        report: (workspaceId: Workspace.Id, actions: EntitlementSDK.UsageActions = this.actions, initialData?: Workspace.Usage.Report) => ({
            queryKey: ['usage', 'report', workspaceId] as const,
            queryFn:  () => actions.getUsageReport(workspaceId),
            staleTime: STALE_TIME,
            initialData,
        }),
        series: (workspaceId: Workspace.Id, actions: EntitlementSDK.UsageActions = this.actions) => ({
            queryKey: ['usage', 'series', workspaceId] as const,
            queryFn:  () => actions.getUsageSeries(workspaceId),
            staleTime: STALE_TIME,
        }),
        records: (workspaceId: Workspace.Id, actions: EntitlementSDK.UsageActions = this.actions) => {
            const window = this.state.windows[workspaceId] ?? DEFAULT_WINDOW

            return {
                queryKey: ['usage', 'records', workspaceId, window] as const,
                queryFn:  () => actions.listUsage(workspaceId, window),
                staleTime: STALE_TIME,
            }
        },
    }

    public readonly actions: EntitlementSDK.Actions = createEntitlementSDKActions(this)
}

export const EntitlementSDK = SDK.get<EntitlementSDKImpl>('Entitlement')

export namespace EntitlementSDK {
    export type State = {
        // Kept here rather than in each table, so a window survives navigating
        // away and back. Absent means DEFAULT_WINDOW.
        windows: Partial<Record<Workspace.Id, Workspace.Usage.Window>>
        reports: Partial<Record<Workspace.Id, Workspace.Usage.Report>>
        series: Partial<Record<Workspace.Id, Workspace.Usage.Point[]>>
        records: Partial<Record<Workspace.Id, Partial<Record<Workspace.Usage.Window, Workspace.Usage[]>>>>
    }

    export type Actions = _EntitlementSDKActions_
    export type UsageActions = Pick<Actions, 'listUsage' | 'getUsageReport' | 'getUsageSeries'>
}
