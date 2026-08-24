import './load-env';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';
import { PortalDB } from './db/portal';
import { FleetDB } from './db/fleet';
import { migrateToLatest, migrationsDir } from './db/migrator';

async function bootstrap(): Promise<void> {
    // Before the modules load: some of them read the database on init.
    await migrateToLatest('portal', PortalDB.forMigrations(), migrationsDir('portal'));
    await migrateToLatest('fleet',  FleetDB.forMigrations(),  migrationsDir('fleet'));

    // rawBody: Stripe signs the exact bytes it sent, and a parsed-then-
    // re-serialised body no longer matches the signature.
    const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

    // A listing carries a whole graph; the default limit is far below one.
    app.useBodyParser('json', { limit: '2mb' });

    // ws rather than socket.io: the portal speaks the same protocol the editor does.
    app.useWebSocketAdapter(new WsAdapter(app));

    // jwks lives at its conventional address, outside the api prefix.
    app.setGlobalPrefix('api', { exclude: ['.well-known/jwks.json'] });

    app.enableCors({
        origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5174').split(',').map((o) => o.trim()),
        credentials: true,
    });

    const port = process.env.PORT ?? 4000;

    await app.listen(port);

    console.log(`Control plane listening on http://localhost:${port}`);
}

bootstrap().catch((error: unknown) => {
    console.error('Boot failed:', error instanceof Error ? error.message : error);
    process.exit(1);
});
