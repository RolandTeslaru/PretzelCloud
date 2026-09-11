import { z } from "zod"

/**
 * The substrates a workspace's compute can run on, and each platform's own
 * vocabulary — the constants a driver hands to its API live here, beside the
 * kind they belong to, rather than at the top of the driver that uses them.
 */
export namespace Driver {

    /** Which substrate. Held by the hardware; a workspace never mixes two. */
    export const Kind = z.enum(["docker", "fly"])
    export type  Kind = z.infer<typeof Kind>

    export namespace Fly {

        export const API = "https://api.machines.dev/v1"

        /** A platform region code, branded so a product region is never handed over by mistake. */
        export const Region = z.string().min(1).brand("Fleet.Driver.Fly.Region")
        export type  Region = z.infer<typeof Region>

        /** Metadata rather than labels, and keys may not contain dots. */
        export const WORKSPACE_METADATA = "pretzel_workspace"
        export const ROLE_METADATA      = "pretzel_role"

        /** The port the workspace image serves on. */
        export const SERVICE_PORT = 3001

        /** Seconds between the stop signal and the kill, matching the image's own bound. */
        export const STOP_TIMEOUT_SECONDS = 15

        /** Seconds a settle blocks for; the platform's own ceiling on one wait call. */
        export const WAIT_TIMEOUT_SECONDS = 60

        /** The states the platform can be waited on for. */
        export const SettledState = z.enum(["started", "stopped", "suspended", "destroyed"])
        export type  SettledState = z.infer<typeof SettledState>

        /** No `services` block: machines are reached over the private network, so the platform proxy is never in front of one. */
        export const SERVING_CHECK = {
            serving: {
                type:         "http",
                port:         SERVICE_PORT,
                method:       "GET",
                path:         "/health",
                interval:     "5s",
                timeout:      "3s",
                // Failures before serving are expected and tolerated by the health wait.
                grace_period: "2s",
            },
        }
    }

    export namespace Docker {

        export const WORKSPACE_LABEL = "pretzel.workspace"
        export const ROLE_LABEL      = "pretzel.role"

        /** The port the workspace image serves on. */
        export const SERVICE_PORT = 3001

        /** Bound to loopback, and to a port the daemon picks: the router reaches the machine from the host, nothing on the network can. */
        export const PUBLISH = `127.0.0.1::${SERVICE_PORT}`

        /** Seconds between the stop signal and the kill; the daemon's default of 1 kills a busy machine before its pools close. */
        export const STOP_TIMEOUT_SECONDS = 15
    }
}
