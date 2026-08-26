import { z } from "zod"

/**
 * The substrate a workspace's compute runs on. Held by the hardware, and copied
 * onto each of its machines so that acting on one needs no second read — the
 * database refuses a machine whose driver disagrees with its hardware's.
 */
export const Driver = z.enum(["docker", "fly"])
export type  Driver = z.infer<typeof Driver>
