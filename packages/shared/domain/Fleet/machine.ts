import { z } from "zod"
import { WorkspaceId } from "../Workspace/ids"
import { SiloSecrets } from "./silo-secrets"
import { Driver } from "./driver"

/**
 * Three identifiers, because three parties name a machine at three different
 * times:
 *
 *   Name        ours, derived from the workspace — known before anything exists
 *   ResourceId  the driver's, handed back by create — known only after
 *   Id          this table's own row key — assigned on insert, last of all
 *
 * The name is what makes provisioning re-runnable: a run killed between `create`
 * and the insert left no record of the external id, so the only way to find what
 * it made is to ask for it by a name we can derive again.
 */
export namespace Machine {

    export const Id = z.uuid().brand("Fleet.Machine.Id")
    export type  Id = z.infer<typeof Id>

    // 'combined' is the free-tier shape: one machine holding backend, Redis and
    // worker together.
    export const Role = z.enum(["backend", "worker", "combined"])
    export type  Role = z.infer<typeof Role>

    // `suspended`: frozen in place and resumable without a boot; `stopped`: powered off.
    export const State = z.enum(["creating", "running", "suspended", "stopped", "destroyed"])
    export type  State = z.infer<typeof State>

    // Operator-driven transitions. `restart` is the one users press; the rest
    // are the raw state machine, surfaced only behind dev controls.
    export const LifecycleAction = z.enum(["start", "stop", "suspend", "resume", "restart"])
    export type  LifecycleAction = z.infer<typeof LifecycleAction>

    /**
     * Exactly what a machine starts with. Built once, above the layer that knows
     * about roles — the base needs the owner, and nothing under provisioning
     * knows who that is — then narrowed to the role that will receive it.
     */
    export namespace EnvKeys {

        const Secrets = SiloSecrets.MachineEnv

        /** What both processes read, however the workspace is split up. */
        export const Base = Secrets.pick({
            WORKSPACE_ID: true,
            // The worker decrypts a credential before the node that needs it runs.
            PRETZEL_ENCRYPTION_KEY: true,
            // The backend starts Redis with it; the worker authenticates with it.
            REDIS_PASSWORD: true,
            // How the two prove themselves to each other.
            WORKER_SERVICE_INTERNAL_TOKEN: true,
        }).extend({
            /** Set on every machine that runs workflow code. */
            BLOCK_OUTBOUND_SMTP:     z.string(),
            REFUSE_PRIVATE_NETWORK:  z.string(),
        })
        export type Base = z.infer<typeof Base>

        /**
         * Answers HTTP. Everything a workspace holds that is worth stealing is
         * here, and none of it reaches the role that runs workflow code.
         */
        export const Backend = Base.extend({
            ...Secrets.pick({
                DATABASE_URL: true,
                EXECUTION_TOKEN_SIGNING_KEY: true,
                TRUSTED_PROXY_TOKEN: true,
            }).shape,
            /** The issuer as reached from inside the fleet, not the URL a browser is given. */
            AUTH_URL:                     z.string(),
            TOKEN_ISSUER:                 z.string(),
            /** Verifies tokens, cannot mint them. The signing key never leaves the cloud. */
            WORKSPACE_TOKEN_PUBLIC_KEY:   z.string(),
            /** Named up front, so ownership is not won by arriving first. */
            WORKSPACE_OWNER_ID:           z.string(),
            /** The origin a browser reaches this workspace at. */
            CORS_ORIGIN:                  z.string(),
            /** Every route the workspace asks of the cloud hangs off this. */
            PRETZEL_CLOUD_URL:            z.string(),
            /** Proves this workspace to the cloud. */
            PRETZEL_CLOUD_TOKEN:          z.string(),
            // Placed on the page it serves, rather than used by the machine itself.
            PUBLIC_AUTH_URL:              z.string(),
            PUBLIC_CLOUD_URL:             z.string(),
            PUBLIC_SESSION_COOKIE_DOMAIN: z.string(),
        })
        export type Backend = z.infer<typeof Backend>

        /** One container running both, so it holds what the backend holds. */
        export const Combined = Backend
        export type  Combined = z.infer<typeof Combined>

        /** Its sibling holds the queue and the API it reports to. */
        export const Worker = Base.extend({
            REDIS_HOST: z.string(),
            REDIS_PORT: z.string(),
            API_URL:    z.string(),
        })
        export type Worker = z.infer<typeof Worker>
    }

    /**
     * What a machine is built from, by role. The roles differ in what they are
     * told, so they differ in the type rather than by convention: a worker spec
     * cannot carry the credential that reaches the cloud.
     */
    export namespace Spec {

        const Base = z.object({
            image: z.string(),
            size:  z.string(),
        })

        /** Backend and worker in one machine: nothing to find, nothing to wake. */
        export const Combined = Base.extend({
            role: z.literal("combined"),
            env:  EnvKeys.Combined,
        })
        export type Combined = z.infer<typeof Combined>

        /** Answers HTTP and holds the queue. The only role that may call the fleet. */
        export const Backend = Base.extend({
            role: z.literal("backend"),
            env:  EnvKeys.Backend,
        })
        export type Backend = z.infer<typeof Backend>

        /** Drains the queue on its sibling, and never holds a fleet credential. */
        export const Worker = Base.extend({
            role: z.literal("worker"),
            env:  EnvKeys.Worker,
        })
        export type Worker = z.infer<typeof Worker>

        export const Schema = z.discriminatedUnion("role", [Combined, Backend, Worker])
    }
    export type Spec = z.infer<typeof Spec.Schema>

    /**
     * Suspend snapshots the machine's memory, which the platform caps at 2 GB.
     * A worker is sized by `concurrency × isolate cap` and exceeds it; a backend
     * or combined machine fits. A machine that cannot suspend stops instead.
     */
    export const canSuspend = (role: Role): boolean => role === "backend" || role === "combined"

    /** The states an action can be applied from — the rest are no-ops, not errors. */
    const APPLICABLE_FROM: Record<LifecycleAction, State[]> = {
        start:   ["stopped"],
        stop:    ["running", "suspended"],
        suspend: ["running"],
        resume:  ["suspended"],
        restart: ["running"],
    }

    /**
     * Whether an action means anything for this machine right now. Guards both
     * the capability (a worker never suspends) and the transition (nothing
     * resumes that was never suspended).
     */
    export const canApply = (action: LifecycleAction, machine: { role: Role; state: State }): boolean => {
        if (action === "suspend" && !canSuspend(machine.role))
            return false

        return APPLICABLE_FROM[action].includes(machine.state)
    }

    // A worker reaches the backend for its queue and its API. It goes down
    // before the backend does, and comes up after it, so that it is never
    // running with nothing to talk to.
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

    /** The driver's own handle: a Fly machine id, or a Docker container id. */
    export const ResourceId = z.string().min(1).brand("Fleet.Machine.ResourceId")
    export type  ResourceId = z.infer<typeof ResourceId>

    export namespace Name {

        // Hyphens rather than the underscores Postgres identifiers need — this
        // one names a container, not a database.
        export const Schema = z.string()
            .regex(/^wspace-[0-9a-f-]{36}-(backend|worker|combined)$/)
            .brand("Fleet.Machine.Name")

        export const create = (workspaceId: WorkspaceId, role: Role) =>
            Schema.parse(`wspace-${workspaceId}-${role}`)
    }
    export type Name = z.infer<typeof Name.Schema>

    export const Schema = z.object({
        id:          Id,
        workspaceId: WorkspaceId,
        hardwareId:  z.uuid().brand("Fleet.Hardware.Id"),
        /** Copied from its hardware, so acting on this machine needs no second read. */
        driver:      Driver,
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
