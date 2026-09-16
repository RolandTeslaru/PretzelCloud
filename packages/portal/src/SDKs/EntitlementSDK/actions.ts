import { Workspace } from '@pretzel-cloud/shared/domain'
import { api } from '../api'
import type { EntitlementSDKImpl } from './sdk'

export type _EntitlementSDKActions_ = {
    /** The executions a workspace ran over a window, newest first. */
    listUsage: (workspaceId: Workspace.Id, window: Workspace.Usage.Window) => Promise<Workspace.Usage[]>
    /** Where the workspace stands in the period it is billed over. */
    getUsageReport: (workspaceId: Workspace.Id) => Promise<Workspace.Usage.Report>
    /** Executions per day over that period, every day present. */
    getUsageSeries: (workspaceId: Workspace.Id) => Promise<Workspace.Usage.Point[]>
    /** Which span a workspace's rows are being read over. */
    setWindow: (workspaceId: Workspace.Id, window: Workspace.Usage.Window) => void
}

export function createEntitlementSDKActions(sdk: EntitlementSDKImpl): _EntitlementSDKActions_ {
    const setState = sdk.useStore.setState

    return {
        listUsage: async (workspaceId, window) => {
            const { records } = await Workspace.API.listUsage(api, workspaceId, window)

            setState((s) => {
                s.records[workspaceId] ??= {}
                s.records[workspaceId][window] = records
            })

            return records
        },

        getUsageReport: async (workspaceId) => {
            const report = await Workspace.API.getUsageReport(api, workspaceId)

            setState((s) => { s.reports[workspaceId] = report })

            return report
        },

        getUsageSeries: async (workspaceId) => {
            const { points } = await Workspace.API.getUsageSeries(api, workspaceId)

            setState((s) => { s.series[workspaceId] = points })

            return points
        },

        setWindow: (workspaceId, window) => {
            setState((s) => { s.windows[workspaceId] = window })
        },
    }
}
