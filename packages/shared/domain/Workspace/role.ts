import { z } from "zod"

// Leaf module: imported by Workspace and by Invitation, which Workspace also
// imports. Keeping it separate stops the cycle.
export const Role = z.enum(["owner", "admin", "member"])
export type  Role = z.infer<typeof Role>

const RANK: Record<Role, number> = { member: 0, admin: 1, owner: 2 }

export const atLeast = (role: Role, minimum: Role) => RANK[role] >= RANK[minimum]
