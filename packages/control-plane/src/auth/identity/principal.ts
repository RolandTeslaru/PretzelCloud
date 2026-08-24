import { z } from 'zod';
import { User as UserD, Workspace as WorkspaceD } from '@pretzel-cloud/shared/domain';

export namespace Principal {

    /** A human at the portal. Identity only — authority is per workspace. */
    export namespace User {
        export const Schema = z.object({
            type:   z.literal('user'),
            userId: UserD.Id,
            email:  z.email(),
        })
    }
    export type User = z.infer<typeof User.Schema>

    /** A workspace's own backend, proven by its per-workspace cloud token. */
    export namespace Silo {
        export const Schema = z.object({
            type:        z.literal('silo'),
            workspaceId: WorkspaceD.Id,
        })
    }
    export type Silo = z.infer<typeof Silo.Schema>

    /** A silo reporting upward, or the router. Shared internal token. */
    export namespace Service {
        export const Schema = z.object({
            type:    z.literal('service'),
            service: z.string(),
        })
    }
    export type Service = z.infer<typeof Service.Schema>

    export const Schema = z.discriminatedUnion('type', [User.Schema, Silo.Schema, Service.Schema])
}
export type Principal = z.infer<typeof Principal.Schema>

declare module 'express' {
    interface Request {
        principal?: Principal;
    }
}
