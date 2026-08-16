import { z } from 'zod';
import type { ColumnType, Generated } from 'kysely';

/**
 * Kysely is generic over an interface of these — keys are the literal Postgres
 * table names, which is what `selectFrom('workspaces')` resolves against. `Gen`
 * lists the columns Postgres fills in, so they stay optional on insert.
 */
export type Table<T extends z.ZodTypeAny, Gen extends keyof z.output<T> = never> = {
    [K in keyof z.output<T>]: K extends Gen
        ? Generated<z.output<T>[K]>
        : ColumnType<
            z.output<T>[K],
            K extends keyof z.input<T> ? z.input<T>[K] : z.output<T>[K],
            K extends keyof z.input<T> ? z.input<T>[K] : z.output<T>[K]
        >
};

export type Stamps = 'created_at' | 'updated_at';

export function requireEnv(name: string): string {
    const value = process.env[name];

    if (!value)
        throw new Error(`${name} is not set`);

    return value;
}
