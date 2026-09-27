import { z } from "zod"
import { WorkspaceId } from "../Workspace/ids"
import { SiloSecrets } from "./silo-secrets"
import { Driver as DriverMod } from "./driver"
import { Release } from "./release"
import { Plan } from "../Plan"

export namespace Machine {

    export const Id = z.uuid().brand("Fleet.Machine.Id")
    export type  Id = z.infer<typeof Id>

    export const Role = z.enum(["backend", "worker", "combined"])
    export type  Role = z.infer<typeof Role>

    export const State = z.enum(["creating", "running", "suspended", "stopped", "destroyed"])
    export type  State = z.infer<typeof State>

    export const LifecycleAction = z.enum(["start", "stop", "suspend", "resume", "restart"])
    export type  LifecycleAction = z.infer<typeof LifecycleAction>

    /** How a lifecycle command runs; omitting a field keeps the default. */
    export const CommandOptions = z.object({
        /** Wait until the platform reports the new state. Defaults to true. */
        awaitSettled: z.boolean().optional(),
    })
    export type CommandOptions = z.infer<typeof CommandOptions>

    /** Callbacks a lifecycle command runs as it progresses. */
    export type CommandEffects = {
        /** Called once the platform reports the new state, whether or not the command waited for it. */
        onSettled?: () => Promise<void>
    }




    export namespace EnvKeys {

        const Secrets = SiloSecrets.MachineEnv

        /** Env shared by every role. */
        export const Base = Secrets.pick({
            WORKSPACE_ID: true,
            PRETZEL_ENCRYPTION_KEY: true,
            REDIS_PASSWORD: true,
            WORKER_SERVICE_INTERNAL_TOKEN: true,
        }).extend({
            BLOCK_OUTBOUND_SMTP:     z.string(),
            REFUSE_PRIVATE_NETWORK:  z.string(),
            EXECUTION_CONCURRENCY:   z.string(),
            WORKER_IDLE_SECONDS:     z.string(),
        })
        export type Base = z.infer<typeof Base>

        /** Env for the backend role. */
        export const Backend = Base.extend({
            ...Secrets.pick({
                DATABASE_URL: true,
                EXECUTION_TOKEN_SIGNING_KEY: true,
                TRUSTED_PROXY_TOKEN: true,
            }).shape,
            /** Issuer URL as reached from inside the fleet. */
            AUTH_URL:                     z.string(),
            TOKEN_ISSUER:                 z.string(),
            WORKSPACE_TOKEN_PUBLIC_KEY:   z.string(),
            WORKSPACE_OWNER_ID:           z.string(),
            CORS_ORIGIN:                  z.string(),
            PRETZEL_CLOUD_URL:            z.string(),
            PRETZEL_CLOUD_TOKEN:          z.string(),
            /** The workers this backend drives, comma-separated; empty on a combined machine. */
            WORKER_IDS:                   z.string(),
            /** Browser-facing values, injected into the served page. */
            PUBLIC_AUTH_URL:              z.string(),
            PUBLIC_CLOUD_PORTAL_URL:      z.string(),
            PUBLIC_SESSION_COOKIE_DOMAIN: z.string(),
        })
        export type Backend = z.infer<typeof Backend>

        /** Env for the combined role. */
        export const Combined = Backend
        export type  Combined = z.infer<typeof Combined>

        /** Env for the worker role. */
        export const Worker = Base.extend({
            WORKER_ID:  z.string(),
            REDIS_HOST: z.string(),
            REDIS_PORT: z.string(),
            API_URL:    z.string(),
        })
        export type Worker = z.infer<typeof Worker>
    }




    /** One machine's entry in a reading: always present, numbers only while it runs. */
    export namespace Statistics {
        export const Schema = z.object({
            role:          Role,
            state:         State,
            cpuPercent:    z.number().nullable(),
            memUsedBytes:  z.number().nullable(),
            memTotalBytes: z.number().nullable(),
        })
    }
    export type Statistics = z.infer<typeof Statistics.Schema>




    /** What a machine is built from, discriminated by role. */
    export namespace Spec {

        const Base = z.object({
            /** Chosen before the machine exists, so the backend can be built knowing its workers. */
            id:    Id,
            image: z.string(),
            size:  z.string(),
        })

        export const Combined = Base.extend({
            role: z.literal("combined"),
            env:  EnvKeys.Combined,
        })
        export type Combined = z.infer<typeof Combined>

        export const Backend = Base.extend({
            role: z.literal("backend"),
            env:  EnvKeys.Backend,
        })
        export type Backend = z.infer<typeof Backend>

        export const Worker = Base.extend({
            role: z.literal("worker"),
            env:  EnvKeys.Worker,
        })
        export type Worker = z.infer<typeof Worker>

        export const Schema = z.discriminatedUnion("role", [Combined, Backend, Worker])

        /** One role's spec: the backend gets the credentials and its workers' ids, a worker only where its sibling is. */
        export const create = (
            id:          Id,
            role:        Role,
            workspaceId: WorkspaceId,
            plan:        Plan,
            release:     Release,
            baseEnvKeys:    EnvKeys.Base,
            backendEnvKeys: EnvKeys.Backend,
            backendHost: string | null,
        ): Spec => {
            if (role === "combined" || role === "backend")
                return {
                    id,
                    role,
                    image: Release.getImageForRole(release, role),
                    size:  Plan.getSizeForRole(plan, role),
                    env:   backendEnvKeys,
                }

            if (!backendHost)
                throw new Error(`A worker for ${workspaceId} has no backend to reach`)

            // Built from the base env, so a backend-only key can never leak to a worker.
            return {
                id,
                role,
                image: Release.getImageForRole(release, role),
                size:  Plan.getSizeForRole(plan, role),
                env:   {
                    ...baseEnvKeys,
                    WORKER_ID:  id,
                    REDIS_HOST: backendHost,
                    REDIS_PORT: "6379",
                    API_URL:    `http://${backendHost}:3001`,
                },
            }
        }
    }
    export type Spec = z.infer<typeof Spec.Schema>




    /** Workers exceed the platform's suspend memory cap, so only these roles suspend. */
    export const canSuspend = (role: Role): boolean => role === "backend" || role === "combined"

    /** States each action is valid from; anything else is a no-op. */
    const APPLICABLE_FROM: Record<LifecycleAction, State[]> = {
        start:   ["stopped"],
        stop:    ["running", "suspended"],
        suspend: ["running"],
        resume:  ["suspended"],
        restart: ["running"],
    }

    /** Whether the action is valid for this machine's role and state. */
    export const canApply = (action: LifecycleAction, machine: { role: Role; state: State }): boolean => {
        if (action === "suspend" && !canSuspend(machine.role))
            return false

        return APPLICABLE_FROM[action].includes(machine.state)
    }

    /** Workers go down before the backend and come up after it. */
    const TEARDOWN_RANK: Record<Role, number> = {
        worker:   0,
        combined: 1,
        backend:  2,
    }

    const BRINGS_UP: LifecycleAction[] = ["start", "resume"]

    export const inLifecycleOrder = <T extends { role: Role }>(action: LifecycleAction, machines: T[]): T[] => {
        const ordered = [...machines].sort((a, b) => TEARDOWN_RANK[a.role] - TEARDOWN_RANK[b.role])

        return BRINGS_UP.includes(action) ? ordered.reverse() : ordered
    }




    /** The driver's handle: a Fly machine id or a Docker container id. */
    export const ResourceId = z.string().min(1).brand("Fleet.Machine.ResourceId")
    export type  ResourceId = z.infer<typeof ResourceId>

    export namespace Name {

        export const Schema = z.string()
            .regex(/^wspace-[0-9a-f-]{36}-(backend|combined|worker-[0-9a-f]{8})$/)
            .brand("Fleet.Machine.Name")

        /** Workers carry the start of their id, since a workspace runs several. */
        export const create = (workspaceId: WorkspaceId, role: Role, id: Id) => {
            const suffix = role === "worker"
                ? `worker-${id.slice(0, 8)}`
                : role

            return Schema.parse(`wspace-${workspaceId}-${suffix}`)
        }
    }
    export type Name = z.infer<typeof Name.Schema>




    export const Schema = z.object({
        id:          Id,
        workspaceId: WorkspaceId,
        hardwareId:  z.uuid().brand("Fleet.Hardware.Id"),
        /** Denormalised from hardware. */
        driver:      DriverMod.Kind,
        resourceId:  ResourceId,
        role:        Role,
        size:        z.string(),
        state:       State,
        lastBootAt:  z.coerce.date().nullable(),
        lastSeenAt:  z.coerce.date().nullable(),
        createdAt:   z.coerce.date(),
        updatedAt:   z.coerce.date(),
    })
}
export type Machine = z.infer<typeof Machine.Schema>
