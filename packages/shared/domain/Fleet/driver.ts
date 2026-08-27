import { z } from "zod"

// The substrate a workspace's compute runs on. Held by the hardware.
export const Driver = z.enum(["docker", "fly"])
export type  Driver = z.infer<typeof Driver>
