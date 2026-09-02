import { z } from "zod"
import type { AxiosInstance } from "axios"
import type { Machine } from "./machine"

export namespace Release {

    export const Id = z.uuid().brand("Fleet.Release.Id")
    export type  Id = z.infer<typeof Id>

    /** Human-readable: a git tag when the commit has one, a short SHA otherwise. */
    export const Name = z.string().min(1).max(120).brand("Fleet.Release.Name")
    export type  Name = z.infer<typeof Name>

    /**
     * One shipped version of the product: a name and the image each role runs.
     * Digest-pinned refs, never tags — a tag is a mutable pointer, a digest is
     * the content itself.
     */
    export const Schema = z.object({
        id:            Id,
        name:          Name,
        imageCombined: z.string(),
        imageBackend:  z.string(),
        imageWorker:   z.string(),
        createdAt:     z.coerce.date(),
    })

    export namespace API {

        export namespace Latest {
            export const Response = z.object({ id: Id, name: Name })
            export type  Response = z.infer<typeof Response>
        }

        export async function latest(api: AxiosInstance): Promise<Latest.Response> {
            const { data } = await api.get<Latest.Response>('/api/releases/latest')
            return Latest.Response.parse(data)
        }

        export namespace Create {
            export const Request = z.object({
                name:          Name,
                imageCombined: z.string().min(1),
                imageBackend:  z.string().min(1),
                imageWorker:   z.string().min(1),
            })
            export type  Request = z.infer<typeof Request>

            export const Response = z.object({ release: Schema })
            export type  Response = z.infer<typeof Response>
        }
    }

    /** The image the role boots from. */
    export const getImageForRole = (release: Release, role: Machine.Role): string => {
        if (role === "combined")
            return release.imageCombined

        return role === "backend" ? release.imageBackend : release.imageWorker
    }
}
export type Release = z.infer<typeof Release.Schema>
