import { z } from "zod"
import { WorkspaceId } from "../Workspace/ids"

/**
 * Three identifiers, because three parties name a machine at three different
 * times:
 *
 *   Name        ours, derived from the workspace — known before anything exists
 *   ExternalId  the driver's, handed back by create — known only after
 *   Id          this table's own row key — assigned on insert, last of all
 *
 * The name is what makes provisioning re-runnable: a run killed between `create`
 * and the insert left no record of the external id, so the only way to find what
 * it made is to ask for it by a name we can derive again.
 */
export namespace Machine {

    export const Id = z.uuid().brand("Fleet.Machine.Id")
    export type  Id = z.infer<typeof Id>

    // Where the container runs. Everything else in provisioning is identical
    // across the two.

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
     * Everything a machine is built from. `backendToken` sits beside the env
     * rather than inside it because only one role may receive it: the worker
     * runs workflow code, so the credential that reaches the fleet must not be
     * copied into every machine.
     */
    /**
     * What a machine is built from, by role. The roles differ in what they need
     * to know — the backend holds a fleet credential, the worker holds its
     * sibling's address — so they differ in the type rather than by convention:
     * a worker spec cannot carry the credential that reaches the control plane.
     */
    export namespace Spec {

        const Base = z.object({
            image: z.string(),
            size:  z.string(),
            /** What every machine of a workspace receives, whatever its role. */
            env:   z.record(z.string(), z.string()),
        })

        /** Backend and worker in one machine: nothing to find, nothing to wake. */
        export const Combined = Base.extend({ role: z.literal("combined") })
        export type  Combined = z.infer<typeof Combined>

        /** Answers HTTP and holds the queue. The only role that may call the fleet. */
        export const Backend = Base.extend({
            role:          z.literal("backend"),
            backendToken:  z.string(),
            wakeWorkerUrl: z.string(),
        })
        export type Backend = z.infer<typeof Backend>

        /** Drains the queue on its sibling, and never holds a fleet credential. */
        export const Worker = Base.extend({
            role:        z.literal("worker"),
            /** Where the backend is reached — the queue and the API are both there. */
            backendHost: z.string(),
        })
        export type Worker = z.infer<typeof Worker>

        export const Schema = z.discriminatedUnion("role", [Combined, Backend, Worker])

        /** What the fleet supplies; everything else is derived from the workspace. */
        export type Inputs = {
            ownerId:     string
            /** The workspace's own secrets, as its machines receive them. */
            secrets:     Record<string, string>
            authUrl:     string
            tokenIssuer: string
            /** Verifies tokens, cannot mint them. */
            publicKey:   string
            /** Where a browser reaches this workspace. */
            appOrigin:   string
            /** Reaches the control plane. Only the backend role is given it. */
            backendToken: string
        }

        /** The env every role receives. Each variant adds its own on top. */
        export const baseEnv = (inputs: Inputs): Record<string, string> => ({
            ...inputs.secrets,
            // The issuer as reached from inside the container, not the URL a
            // browser is given.
            AUTH_URL:                   inputs.authUrl,
            // Verifies, cannot mint. The signing key never leaves the control plane.
            WORKSPACE_TOKEN_PUBLIC_KEY: inputs.publicKey,
            TOKEN_ISSUER:               inputs.tokenIssuer,
            // Names the owner up front, so ownership is not won by arriving first.
            WORKSPACE_OWNER_ID:         inputs.ownerId,
            // The origin a browser reaches this workspace at.
            CORS_ORIGIN:                inputs.appOrigin,
        })

        /**
         * The environment a machine actually starts with: what every role gets,
         * plus what this one's own fields say. Exhaustive on purpose — a new
         * role fails to compile until it says how it is wired.
         */
        export const toEnv = (spec: Spec): Record<string, string> => {
            switch (spec.role) {
                case "combined":
                    return spec.env;

                case "backend":
                    return {
                        ...spec.env,
                        // Its own credential and the one call it makes: waking
                        // the worker before handing it something to run.
                        CONTROL_PLANE_TOKEN: spec.backendToken,
                        WORKER_WAKE_URL:     spec.wakeWorkerUrl,
                    };

                case "worker":
                    return {
                        ...spec.env,
                        // Its sibling holds the queue and the API it reports to.
                        REDIS_HOST: spec.backendHost,
                        REDIS_PORT: "6379",
                        API_URL:    `http://${spec.backendHost}:3001`,
                    };
            }
        }
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

    /** The driver's own handle: a Fly machine id, or a Docker container id. */
    export const ExternalId = z.string().min(1).brand("Fleet.Machine.ExternalId")
    export type  ExternalId = z.infer<typeof ExternalId>

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
        hardwareId:  z.uuid().brand("Fleet.Hardware.Id").nullable(),
        externalId:  ExternalId,
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
