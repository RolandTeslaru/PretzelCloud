// Must stay first: these modules read env at import time.
import '../load-env';

import { PortalDB } from './portal';
import { FleetDB } from './fleet';
import { migrateToLatest, migrationsDir } from './migrator';

// Two databases, migrated independently. Neither references the other, so the
// order here is arbitrary.
async function main(): Promise<void> {
    await migrateToLatest('portal', PortalDB.forMigrations(), migrationsDir('portal'));
    await migrateToLatest('fleet',  FleetDB.forMigrations(),  migrationsDir('fleet'));

    await PortalDB.destroyPools();
    await FleetDB.destroyPools();
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
