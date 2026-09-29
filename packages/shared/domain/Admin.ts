import { z } from 'zod'
import type { AxiosInstance } from 'axios'
import { Plan } from './Plan'
import { Workspace } from './Workspace'
import { User } from './User'
import { Listing } from './Listing'
import { Template } from './Template'
import { ExtendedShelf } from './ExtendedShelf'

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

    /** A listed workflow at its latest version, with how an admin has tagged it. */
    export const ListingSummary = z.object({
        id:          Listing.Id,
        workspace:   z.object({ id: Workspace.Id, displayName: z.string() }),
        workflowId:  Listing.WorkflowId,
        name:        z.string(),
        description: z.string().nullable(),
        version:     z.number().int(),
        release:     Listing.Release,
        publishedAt: z.coerce.date(),
        createdAt:   z.coerce.date(),
        blueprintId: z.string().nullable(),
        template:    Template.API.Set.Request.nullable(),
    })
    export type ListingSummary = z.infer<typeof ListingSummary>

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

        export namespace Listings {
            export namespace List {
                export const Response = z.object({ listings: z.array(ListingSummary) })
                export type Response = z.infer<typeof Response>
            }

            export async function list(api: AxiosInstance): Promise<List.Response> {
                const { data } = await api.get('/api/admin/listings')
                return List.Response.parse(data)
            }
        }

        export namespace Templates {
            export async function set(api: AxiosInstance, listingId: Listing.Id, body: Template.API.Set.Request): Promise<void> {
                await api.put(`/api/admin/templates/${listingId}`, body)
            }

            export async function remove(api: AxiosInstance, listingId: Listing.Id): Promise<void> {
                await api.delete(`/api/admin/templates/${listingId}`)
            }
        }

        export namespace Shelf {
            export async function add(api: AxiosInstance, listingId: Listing.Id, body: ExtendedShelf.API.Add.Request): Promise<void> {
                await api.put(`/api/admin/extended-shelf/${listingId}`, body)
            }

            export async function remove(api: AxiosInstance, listingId: Listing.Id): Promise<void> {
                await api.delete(`/api/admin/extended-shelf/${listingId}`)
            }
        }

        export namespace Plans {
            export const Response = Plan.API.List.Response
            export type Response = z.infer<typeof Response>

            export async function list(api: AxiosInstance): Promise<Response> {
                const { data } = await api.get('/api/admin/plans')
                return Response.parse(data)
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

        export namespace SetPlan {
            export const Request = Workspace.API.SetPlan.Request
            export type Request = z.infer<typeof Request>
        }

        export async function setPlan(api: AxiosInstance, workspaceId: Workspace.Id, body: SetPlan.Request): Promise<void> {
            await api.post(`/api/admin/workspaces/${workspaceId}/plan`, body)
        }
    }
}
