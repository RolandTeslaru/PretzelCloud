import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { Kysely, Migrator, sql, type Migration, type MigrationProvider } from 'kysely';

/**
 * Kysely's own FileMigrationProvider imports `.js`/`.ts` and silently ignores
 * `.sql`. This one reads a directory in name order and executes each file whole.
 */
class SqlMigrationProvider implements MigrationProvider {

    constructor(private readonly folder: string) {}

    async getMigrations(): Promise<Record<string, Migration>> {
        const files = (await fs.readdir(this.folder))
            .filter((file) => file.endsWith('.sql'))
            .sort();

        const migrations: Record<string, Migration> = {};

        for (const file of files) {
            const text = await fs.readFile(path.join(this.folder, file), 'utf8');

            migrations[path.basename(file, '.sql')] = {
                up: async (db: Kysely<unknown>) => {
                    await sql.raw(text).execute(db);
                },
            };
        }

        return migrations;
    }
}

/** Brings one database to the latest migration. Throws on the first failure. */
export async function migrateToLatest<T>(name: string, db: Kysely<T>, folder: string): Promise<void> {
    const migrator = new Migrator({
        db: db as unknown as Kysely<unknown>,
        provider: new SqlMigrationProvider(folder),
    });

    const { error, results } = await migrator.migrateToLatest();

    for (const result of results ?? [])
        if (result.status === 'Success')
            console.log(`[${name}] applied ${result.migrationName}`);
        else if (result.status === 'Error')
            console.error(`[${name}] failed ${result.migrationName}`);

    if (error)
        throw error instanceof Error ? error : new Error(String(error));
}

export const migrationsDir = (database: 'portal' | 'fleet') =>
    path.resolve(import.meta.dirname, '../../migrations', database);
