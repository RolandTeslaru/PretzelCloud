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
    }
}
