import { z } from "zod"
import type { AxiosInstance } from "axios"
import { User } from "../User"
import { Cluster } from "../Fleet/cluster"
import { WorkspaceId, createId as createWorkspaceId } from "./ids"
import * as SubdomainMod from "./subdomain"

// A workspace as the portal knows it: desired state. What has been materialized
// for it lives in Fleet, on another credential.
export namespace Workspace {

    export const Id = WorkspaceId
    export type  Id = WorkspaceId
    export const createId = createWorkspaceId

    export import Subdomain = SubdomainMod.Subdomain

    // 'failed' is not a state the user sees. A workspace that cannot be
    // provisioned is torn down and its row deleted, so they simply retry; the
    // row survives only when teardown itself failed and the reconciler still
    // has work to do.
    export const Status = z.enum(["provisioning", "ready", "suspended", "failed"])
    export type  Status = z.infer<typeof Status>

    export const Plan = z.enum(["free", "pro"])
    export type  Plan = z.infer<typeof Plan>


    export const DisplayName = z.string().trim()
        .min(1, 'Workspace name is required')
        .max(64, 'Workspace name must be at most 64 characters')

    // What this workspace's database and role are called in the cluster. Derived
    // from the id rather than stored, so nothing can drift and a workspace whose
    // row is lost is still locatable. Underscores because a uuid's dashes are not
    // legal in an unquoted identifier.
    const identifier = (id: Id) => id.replace(/-/g, '')

    export const getDatabaseName = (id: Id) =>
        Cluster.Database.Name.parse(`wspace_${identifier(id)}`)

    export const getRoleName = (id: Id) =>
        Cluster.Role.Name.parse(`wspace_role_${identifier(id)}`)

    export const Schema = z.object({
        id:          Id,
        // Null until a paid plan sets one; the canonical host is derived.
        subdomain:   Subdomain.Schema.nullable(),
        displayName: z.string(),
        status:      Status,
        plan:        Plan,
        ownerId:     User.Id,
        createdAt:   z.coerce.date(),
        updatedAt:   z.coerce.date(),
    })

    // Inline rather than a sibling file: these reference Schema and Subdomain
    // above, and a separate module importing back into this one would be a
    // cycle that leaves the zod schemas undefined at load.
    export namespace API {

        export namespace List {
            export const Response = z.object({ workspaces: z.array(Schema) })
            export type  Response = z.infer<typeof Response>
        }

        export async function list(api: AxiosInstance): Promise<List.Response> {
            const { data } = await api.get<List.Response>('/api/workspaces')
            return List.Response.parse(data)
        }

        export namespace Create {
            export const Request = z.object({ displayName: DisplayName })
            export type  Request = z.infer<typeof Request>

            export const Response = z.object({ workspace: Schema })
            export type  Response = z.infer<typeof Response>
        }

        // Blocks until the workspace is provisioned, or the row is torn down.
        export async function create(api: AxiosInstance, req: Create.Request): Promise<Create.Response> {
            const { data } = await api.post<Create.Response>('/api/workspaces', req)
            return Create.Response.parse(data)
        }

        export namespace Get {
            export const Response = z.object({ workspace: Schema })
            export type  Response = z.infer<typeof Response>
        }

        export async function get(api: AxiosInstance, workspaceId: Id): Promise<Get.Response> {
            const { data } = await api.get<Get.Response>(`/api/workspaces/${workspaceId}`)
            return Get.Response.parse(data)
        }

        export namespace Rename {
            export const Request = z.object({ displayName: DisplayName })
            export type  Request = z.infer<typeof Request>

            export const Response = z.object({})
            export type  Response = z.infer<typeof Response>
        }

        export async function rename(api: AxiosInstance, workspaceId: Id, req: Rename.Request): Promise<Rename.Response> {
            const { data } = await api.patch<Rename.Response>(`/api/workspaces/${workspaceId}`, req)
            return Rename.Response.parse(data)
        }

        // Null clears it. Paid plans only; the canonical host is unaffected.
        export namespace SetSubdomain {
            export const Request = z.object({ subdomain: Subdomain.Custom.nullable() })
            export type  Request = z.infer<typeof Request>

            export const Response = z.object({})
            export type  Response = z.infer<typeof Response>
        }

        export async function setSubdomain(api: AxiosInstance, workspaceId: Id, req: SetSubdomain.Request): Promise<SetSubdomain.Response> {
            const { data } = await api.patch<SetSubdomain.Response>(`/api/workspaces/${workspaceId}/subdomain`, req)
            return SetSubdomain.Response.parse(data)
        }

        export namespace Destroy {
            export const Response = z.object({})
            export type  Response = z.infer<typeof Response>
        }

        export async function destroy(api: AxiosInstance, workspaceId: Id): Promise<Destroy.Response> {
            const { data } = await api.delete<Destroy.Response>(`/api/workspaces/${workspaceId}`)
            return Destroy.Response.parse(data)
        }

    }
}
export type Workspace = z.infer<typeof Workspace.Schema>

