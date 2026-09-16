import { z } from 'zod'
import type { AxiosInstance } from 'axios'
import { Workspace } from './Workspace'
import { User } from './User'

export namespace Admin {
    export const WorkspaceSummary = z.object({
        workspace: Workspace.Schema,
        owner:     User.Schema,
    })
    export type WorkspaceSummary = z.infer<typeof WorkspaceSummary>

    export const UserSummary = User.Schema.extend({ ownedWorkspaceCount: z.coerce.number().int().nonnegative() })
    export type UserSummary = z.infer<typeof UserSummary>

    /** One workspace with everything an admin needs to answer for it. */
    export const WorkspaceDetail = z.object({
        workspace:          Workspace.Schema,
        owner:              User.Schema,
        members:            z.array(User.Schema),
        usage:              Workspace.Usage.Report,
        hardwareStatistics: Workspace.HardwareStatistics.Schema.nullable(),
    })
    export type WorkspaceDetail = z.infer<typeof WorkspaceDetail>

    export namespace API {
        export namespace Users {
            export namespace List {
                export const Response = z.object({ users: z.array(UserSummary) })
                export type Response = z.infer<typeof Response>
            }

            export async function list(api: AxiosInstance): Promise<List.Response> {
                const { data } = await api.get('/api/admin/users')
                return List.Response.parse(data)
            }

            export namespace Delete {
                export const Request = z.object({ confirmation: z.string().trim().email() })
                export type Request = z.infer<typeof Request>
            }

            export async function remove(api: AxiosInstance, userId: User.Id, body: Delete.Request): Promise<void> {
                await api.delete(`/api/admin/users/${userId}`, { data: body })
            }
        }

        export namespace List {
            export const Response = z.object({ workspaces: z.array(WorkspaceSummary) })
            export type Response = z.infer<typeof Response>
        }

        export async function list(api: AxiosInstance): Promise<List.Response> {
            const { data } = await api.get('/api/admin/workspaces')
            return List.Response.parse(data)
        }

        export namespace Get {
            export const Response = WorkspaceDetail
            export type Response = z.infer<typeof Response>
        }

        export async function get(api: AxiosInstance, workspaceId: Workspace.Id): Promise<Get.Response> {
            const { data } = await api.get(`/api/admin/workspaces/${workspaceId}`)
            return Get.Response.parse(data)
        }

        export async function lifecycle(api: AxiosInstance, workspaceId: Workspace.Id, action: Workspace.Lifecycle.Action): Promise<void> {
            await api.post(`/api/admin/workspaces/${workspaceId}/lifecycle/${action}`)
        }

        export namespace Usage {
            export async function list(api: AxiosInstance, workspaceId: Workspace.Id, window: Workspace.Usage.Window): Promise<Workspace.API.ListUsage.Response> {
                const { data } = await api.get(`/api/admin/workspaces/${workspaceId}/executions`, { params: { window } })
                return Workspace.API.ListUsage.Response.parse(data)
            }

            export async function getSeries(api: AxiosInstance, workspaceId: Workspace.Id): Promise<Workspace.API.GetUsageSeries.Response> {
                const { data } = await api.get(`/api/admin/workspaces/${workspaceId}/executions/series`)
                return Workspace.API.GetUsageSeries.Response.parse(data)
            }

            export async function getReport(api: AxiosInstance, workspaceId: Workspace.Id): Promise<Workspace.API.GetUsageReport.Response> {
                const { data } = await api.get(`/api/admin/workspaces/${workspaceId}/executions/report`)
                return Workspace.API.GetUsageReport.Response.parse(data)
            }
        }

        export namespace Destroy {
            export const Request = z.object({ confirmation: Workspace.DisplayName })
            export type Request = z.infer<typeof Request>
        }

        export async function destroy(api: AxiosInstance, workspaceId: Workspace.Id, body: Destroy.Request): Promise<void> {
            await api.delete(`/api/admin/workspaces/${workspaceId}`, { data: body })
        }

        export namespace Disable {
            export const Request = z.object({ reason: z.string().trim().optional() }).default({})
            export type Request = z.infer<typeof Request>
        }

        export async function disable(api: AxiosInstance, workspaceId: Workspace.Id, body: Disable.Request): Promise<void> {
            await api.post(`/api/admin/workspaces/${workspaceId}/disable`, body)
        }

        export async function enable(api: AxiosInstance, workspaceId: Workspace.Id): Promise<void> {
            await api.post(`/api/admin/workspaces/${workspaceId}/enable`)
        }
    }
}
