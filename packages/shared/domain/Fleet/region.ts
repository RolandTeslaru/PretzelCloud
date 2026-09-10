import { z } from "zod"
import { Driver } from "./driver"

/**
 * Where a workspace lives — its database and its machines together. Named by
 * the database provider's region code, which is the value stored on rows; each
 * maps to one platform region, so compute and storage cannot be placed apart.
 */
export namespace Region {

    export const Schema = z.enum(["us-east-1", "eu-central-1"])
    export type  Schema = z.infer<typeof Schema>

    type Placement = {
        displayName: string
        fly:         Driver.Fly.Region
    }

    const PLACEMENT: Record<Schema, Placement> = {
        "us-east-1":    { displayName: "United States", fly: Driver.Fly.Region.parse("iad") },
        "eu-central-1": { displayName: "Europe",        fly: Driver.Fly.Region.parse("fra") },
    }

    export const getDisplayName = (region: Schema): string => PLACEMENT[region].displayName

    /** Where the machines go. The database goes to the region itself. */
    export const getFlyRegion = (region: Schema): Driver.Fly.Region => PLACEMENT[region].fly

    /** Every region, for a picker. */
    export const all = (): Schema[] => Schema.options
}
