import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { FleetDB } from '@/db/fleet';
import { MachineDriver } from './drivers/driver';
import { DockerDriver } from './drivers/docker.driver';

/**
 * The only door to the fleet database and the driver. Nothing else imports
 * FleetDB, so "who can read a workspace's connection string" stays a one-file
 * question.
 */
@Injectable()
export class FleetService {

    private readonly logger = new Logger(FleetService.name);

    constructor(private readonly driver: MachineDriver) {}

    /** Idempotent: an existing row keeps its key, so re-runs cannot strand ciphertext. */
    async ensureSecrets(workspaceId: Workspace.Id, databaseUrl: Fleet.Cluster.Database.ConnectionURL): Promise<void> {
        await FleetDB.asService('write workspace secrets', async (db) => {
            const existing = await db
                .selectFrom('workspace_secrets')
                .select('workspace_id')
                .where('workspace_id', '=', workspaceId)
                .executeTakeFirst();

            if (existing) {
                await db
                    .updateTable('workspace_secrets')
                    .set({ database_url: databaseUrl })
                    .where('workspace_id', '=', workspaceId)
                    .execute();

                return;
            }

            await db
                .insertInto('workspace_secrets')
                .values({
                    workspace_id:      workspaceId,
                    database_url:      databaseUrl,
                    // 32 bytes as hex, the shape PRETZEL_ENCRYPTION_KEY requires.
                    encryption_key: randomBytes(32).toString('hex'),
                })
                .execute();
        });
    }

    /**
     * The only shape these values leave this service in. There is no accessor
     * that returns the row.
     */
    async machineEnv(workspaceId: Workspace.Id): Promise<Fleet.WorkspaceSecrets.MachineEnv | null> {
        return FleetDB.asService('read machine env', async (db) => {
            const row = await db
                .selectFrom('workspace_secrets')
                .selectAll()
                .where('workspace_id', '=', workspaceId)
                .executeTakeFirst();

            return row ? FleetDB.WorkspaceSecrets.toMachineEnv(FleetDB.WorkspaceSecrets.Row.parse(row)) : null;
        });
    }

    async createMachine(
        workspaceId: Workspace.Id,
        role: Fleet.Machine.Role,
        options: { image: string, size: string, env: Record<string, string> },
    ): Promise<void> {
        const handle = await this.driver.create({
            workspaceId,
            name: Fleet.Machine.Name.create(workspaceId, role),
            role,
            image: options.image,
            size:  options.size,
            env:   options.env,
        });

        await FleetDB.asService('record machine', (db) =>
            db
                .insertInto('machines')
                .values({
                    workspace_id: workspaceId,
                    driver:       this.driver.kind,
                    external_id:  handle.externalId,
                    role,
                    size:         options.size,
                    state:        handle.state,
                    last_boot_at: new Date(),
                    last_seen_at: null,
                })
                // The unique index on (workspace_id, role) is what makes a
                // re-run land here instead of creating a second machine.
                .onConflict((oc) => oc
                    .columns(['workspace_id', 'role'])
                    .doUpdateSet({ external_id: handle.externalId, state: handle.state }))
                .execute(),
        );
    }

    /** The pair every workspace answers at, derived from its id. Never removed. */
    async registerCanonicalHostnames(workspaceId: Workspace.Id): Promise<void> {
        const canonical = Workspace.Subdomain.canonical(workspaceId);

        await this.register(workspaceId, Fleet.Hostname.Host.createAll(canonical));
    }

    /**
     * Replaces the custom pair, leaving the canonical one alone. Passing null
     * clears it. Deleting before inserting means a workspace is never briefly
     * reachable at two different custom names.
     */
    async setCustomHostnames(workspaceId: Workspace.Id, subdomain: Workspace.Subdomain | null): Promise<void> {
        const canonical = Workspace.Subdomain.canonical(workspaceId);
        const keep = Fleet.Hostname.Host.createAll(canonical).map((entry) => entry.host);

        await FleetDB.asService('clear custom hostnames', (db) =>
            db
                .deleteFrom('hostnames')
                .where('workspace_id', '=', workspaceId)
                .where('host', 'not in', keep)
                .execute(),
        );

        if (subdomain)
            await this.register(workspaceId, Fleet.Hostname.Host.createAll(subdomain));
    }

    private async register(workspaceId: Workspace.Id, entries: { host: Fleet.Hostname.Host, kind: Fleet.Hostname.Kind }[]): Promise<void> {
        await FleetDB.asService('register hostnames', (db) =>
            db
                .insertInto('hostnames')
                .values(entries.map((entry) => ({ ...entry, workspace_id: workspaceId })))
                .onConflict((oc) => oc.column('host').doNothing())
                .execute(),
        );
    }

    async machinesFor(workspaceId: Workspace.Id): Promise<Fleet.Machine[]> {
        return FleetDB.asService('list machines', async (db) => {
            const rows = await db
                .selectFrom('machines')
                .selectAll()
                .where('workspace_id', '=', workspaceId)
                .execute();

            return rows.map((row) => FleetDB.Machine.toDomain(FleetDB.Machine.Row.parse(row)));
        });
    }

    /** Asks the driver rather than the row: the daemon is the truth about what is running. */
    async refreshState(workspaceId: Workspace.Id): Promise<void> {
        const machines = await this.machinesFor(workspaceId);

        for (const machine of machines) {
            const state = await this.driver.status(machine.externalId);

            await FleetDB.asService('refresh machine state', (db) =>
                db
                    .updateTable('machines')
                    .set({ state, last_seen_at: new Date() })
                    .where('id', '=', machine.id)
                    .execute(),
            );
        }
    }

    /**
     * Destroys everything materialized for a workspace. Idempotent, and ordered:
     * the machine goes before its record, so a crash leaves a row pointing at
     * something the sweep can still find.
     */
    async teardown(workspaceId: Workspace.Id): Promise<void> {
        for (const handle of await this.driver.findByWorkspace(workspaceId))
            await this.driver.destroy(handle.externalId);

        if (this.driver instanceof DockerDriver)
            await this.driver.destroyNetwork(workspaceId);

        await FleetDB.asService('clear fleet rows', async (db) => {
            await db.deleteFrom('machines').where('workspace_id', '=', workspaceId).execute();
            await db.deleteFrom('hostnames').where('workspace_id', '=', workspaceId).execute();
            await db.deleteFrom('workspace_runtime').where('workspace_id', '=', workspaceId).execute();
            await db.deleteFrom('workspace_secrets').where('workspace_id', '=', workspaceId).execute();
        });

        this.logger.log(`Tore down fleet state for ${workspaceId}`);
    }
}
