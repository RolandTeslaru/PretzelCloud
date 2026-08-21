import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';
import { ProvisioningService } from '@/services/Fleet/provisioning/provisioning.service';
import { HardwareService } from '@/services/Fleet/Hardware/hardware.service';
import { HostnameService } from '@/services/Fleet/Hostname/hostname.service';
import { Principal } from '@/auth/principal';
import { WorkspaceRouter } from '@/services/WorkspaceRouter/router.service';
import { RealtimeService } from '@/services/Realtime/realtime.service';

const PROVISION_ATTEMPTS = 3;

@Injectable()
export class WorkspaceService {

    private readonly logger = new Logger(WorkspaceService.name);

    constructor(
        private readonly provisioning: ProvisioningService,
        private readonly hardware: HardwareService,
        private readonly hostnames: HostnameService,
        private readonly router: WorkspaceRouter,
        private readonly realtime: RealtimeService,
    ) {}

    /**
     * Addressing is derived here, never passed in: a caller that cannot write
     * `channel` or `workspaceId` cannot address another tenant's channel.
     */
    private emit(workspaceId: Workspace.Id, event: Workspace.Event.Unstamped): void {
        const channel = Workspace.Event.getChannel(workspaceId);

        this.realtime.publish(channel, { ...event, channel, workspaceId });
    }

    /**
     * The id is minted first and every step is keyed by it, so a run killed
     * halfway can be repeated. The intent — the row and its owner — is written
     * before anything is materialized, because a machine nobody has a record of
     * is the expensive orphan.
     *
     * If it cannot be provisioned, everything goes and the row with it: the user
     * sees no workspace and clicks create again. The row survives only when
     * teardown itself failed, for the sweep to finish.
     */
    async create(principal: Principal.User, displayName: string): Promise<Workspace> {
        const id = Workspace.createId();

        const owner = await PortalDB.asService('create workspace', async (db) => {
            await db
                .insertInto('workspaces')
                .values({ id, subdomain: null, display_name: displayName, status: 'provisioning', plan: 'free', owner_id: principal.userId })
                .execute();

            // The index entry, so the workspace appears in their grid. The
            // owner's rows in the workspace's own tables are seeded by
            // provisioning, once that database exists.
            await db
                .insertInto('workspace_members')
                .values({ workspace_id: id, user_id: principal.userId })
                .execute();

            // Read here so a missing profile fails before anything is built,
            // rather than partway through provisioning.
            const row = await db
                .selectFrom('users')
                .selectAll()
                .where('id', '=', principal.userId)
                .executeTakeFirst();

            if (!row)
                throw new NotFoundException('No profile yet');

            return PortalDB.User.toDomain(PortalDB.User.Row.parse(row));
        });

        for (let attempt = 1; attempt <= PROVISION_ATTEMPTS; attempt++) {
            try {
                await this.provisioning.provision(id, owner, 'free');

                // Its hostnames were unknown until a moment ago, and a probe in
                // that window would have cached the absence.
                this.router.invalidate(id);

                return this.markReady(id);
            }
            catch (error) {
                this.logger.error(`Provisioning ${id} failed (attempt ${attempt}/${PROVISION_ATTEMPTS}): ${error instanceof Error ? error.message : error}`);
            }
        }

        await this.abandon(id);

        throw new Error('Could not create workspace');
    }

    private async markReady(id: Workspace.Id): Promise<Workspace> {
        return PortalDB.asService('mark workspace ready', async (db) => {
            const row = await db
                .updateTable('workspaces')
                .set({ status: 'ready' })
                .where('id', '=', id)
                .returningAll()
                .executeTakeFirstOrThrow();

            const workspace = PortalDB.Workspace.toDomain(PortalDB.Workspace.Row.parse(row));

            this.emit(id, Workspace.Event.create('provisioning:changed', { provisioningStatus: workspace.provisioningStatus }));

            return workspace;
        });
    }

    /**
     * Teardown first, then the row — deleting the record while the machine is
     * up is the one ordering that loses track of running infrastructure. If
     * teardown throws, the row stays flagged for the sweep.
     */
    private async abandon(id: Workspace.Id): Promise<void> {
        try {
            await this.provisioning.deprovision(id);

            this.router.invalidate(id);
        }
        catch (error) {
            this.logger.error(`Teardown of ${id} failed, leaving it for the sweep: ${error instanceof Error ? error.message : error}`);

            await PortalDB.asService('flag failed workspace', (db) =>
                db.updateTable('workspaces').set({ status: 'failed' }).where('id', '=', id).execute());

            this.emit(id, Workspace.Event.create('provisioning:changed', { provisioningStatus: 'failed' }));

            return;
        }

        await PortalDB.asService('delete abandoned workspace', (db) =>
            db.deleteFrom('workspaces').where('id', '=', id).execute());

        this.emit(id, Workspace.Event.create('destroyed'));
    }

    /** RLS scopes this — there is no membership filter to forget. */
    async list(principal: Principal.User): Promise<Workspace[]> {
        return PortalDB.asUser(principal, async (trx) => {
            const rows = await trx
                .selectFrom('workspaces')
                .innerJoin('workspace_members', 'workspace_members.workspace_id', 'workspaces.id')
                .where('workspace_members.user_id', '=', principal.userId)
                .selectAll('workspaces')
                .orderBy('workspaces.created_at', 'desc')
                .execute();

            const states = await this.hardware.getStates(rows.map((row) => row.id));

            return rows.map((row) =>
                PortalDB.Workspace.toDomain(PortalDB.Workspace.Row.parse(row), states.get(row.id) ?? null));
        });
    }

    /** One workspace, with its live machine state attached. */
    async withRuntime(workspaceId: Workspace.Id): Promise<Workspace> {
        const [base, states] = await Promise.all([
            PortalDB.asService('read workspace', (db) =>
                db.selectFrom('workspaces').selectAll().where('id', '=', workspaceId).executeTakeFirstOrThrow()),
            this.hardware.getStates([workspaceId]),
        ]);

        return PortalDB.Workspace.toDomain(PortalDB.Workspace.Row.parse(base), states.get(workspaceId) ?? null);
    }

    /** The name on the account. Ownership was settled by the guard. */
    async rename(principal: Principal.User, workspaceId: Workspace.Id, displayName: string): Promise<void> {
        await PortalDB.asUser(principal, (trx) =>
            trx
                .updateTable('workspaces')
                .set({ display_name: displayName })
                .where('id', '=', workspaceId)
                .execute());
    }

    /**
     * Paid plans only. The canonical host is untouched, so URLs already handed
     * out keep resolving; only the extra custom pair moves.
     *
     * The database settles uniqueness — checking first and inserting after loses
     * to whoever submits in between.
     */
    async setSubdomain(principal: Principal.User, workspace: Workspace, subdomain: Workspace.Subdomain | null): Promise<void> {
        if (workspace.plan !== 'pro')
            throw new ForbiddenException('A custom subdomain requires a paid plan');

        try {
            await PortalDB.asUser(principal, (trx) =>
                trx
                    .updateTable('workspaces')
                    .set({ subdomain })
                    .where('id', '=', workspace.id)
                    .execute());
        }
        catch (error) {
            if (error instanceof Error && error.message.includes('workspaces_subdomain_key'))
                throw new ConflictException('That subdomain is taken');

            throw error;
        }

        await this.hostnames.setCustom(workspace.id, subdomain);

        this.router.invalidate(workspace.id, [workspace.subdomain, subdomain]);
    }

    /**
     * The account owner, not an in-workspace role: destroying a workspace ends a
     * subscription and tears down infrastructure, neither of which the workspace
     * itself has any say in. A workspace that rewrote its own members table
     * still cannot reach this.
     */
    /**
     * An operator-driven machine transition. Ownership is checked at the guard;
     * the router is invalidated after, since a suspended or stopped machine must
     * stop being a forwarding target.
     */
    async lifecycle(workspaceId: Workspace.Id, action: Fleet.Machine.LifecycleAction): Promise<void> {
        await this.hardware.applyAction(workspaceId, action);

        this.router.invalidate(workspaceId);

        // Read back rather than inferred from the action: what the machine
        // actually settled on is the only state worth pushing.
        const states = await this.hardware.getStates([workspaceId]);

        this.emit(workspaceId, Workspace.Event.create('state:changed', { state: states.get(workspaceId) ?? null }));
    }

    async destroy(principal: Principal.User, workspaceId: Workspace.Id): Promise<void> {
        // Infrastructure first: the row is the only record of what to tear down.
        await this.provisioning.deprovision(workspaceId);

        // Before the row goes: a cached route would otherwise keep answering for
        // a machine that no longer exists.
        this.router.invalidate(workspaceId);

        await PortalDB.asUser(principal, (trx) =>
            trx.deleteFrom('workspaces').where('id', '=', workspaceId).execute());

        this.emit(workspaceId, Workspace.Event.create('destroyed'));
    }
}
