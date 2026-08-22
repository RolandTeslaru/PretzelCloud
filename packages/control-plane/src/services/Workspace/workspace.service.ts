import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Fleet, User, Workspace } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';
import { ProvisioningService } from '@/services/Fleet/provisioning/provisioning.service';
import { HardwareService } from '@/services/Fleet/Hardware/hardware.service';
import { HostnameService } from '@/services/Fleet/Hostname/hostname.service';
import { Principal } from '@/auth/principal';
import { Router } from '@/services/WorkspaceRouter/router.service';
import { RealtimeService } from '@/services/Realtime/realtime.service';

const PROVISION_ATTEMPTS = 3;

@Injectable()
export class WorkspaceService {

    private readonly logger = new Logger(WorkspaceService.name);

    constructor(
        private readonly provisioning: ProvisioningService,
        private readonly hardware: HardwareService,
        private readonly hostnames: HostnameService,
        private readonly router: Router,
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
        if (!Workspace.isPaid(workspace.plan))
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
    /**
     * Wakes the worker so it can drain the queue. Called by the workspace's own
     * backend before it enqueues, which is the only moment anything knows work
     * is coming.
     */
    wakeWorker(workspaceId: Workspace.Id): Promise<void> {
        return this.hardware.startWorker(workspaceId);
    }

    /**
     * Stops the worker once its backend reports the queue has been quiet. The
     * backend holds the clock: it is the machine that never sleeps, and the one
     * that sees every job start and finish.
     */
    sleepWorker(workspaceId: Workspace.Id): Promise<void> {
        return this.hardware.stopWorker(workspaceId);
    }

    /**
     * Starting a workspace means making it answerable, which is its backend. The
     * worker is demand-driven — the backend wakes it before it enqueues — so
     * starting one here would be paying for compute nobody asked for.
     */
    /**
     * Serving by the time this returns — the primitive every trigger path calls
     * before it needs a workspace, rather than each one waking it its own way.
     *
     * Health is asked first, so a workspace already up costs two driver reads
     * and writes nothing. Concurrent callers share one wake: a webhook and a
     * scheduled run arriving together must not start the same machine twice.
     */
    ensureStarted(workspaceId: Workspace.Id): Promise<void> {
        const inFlight = this.starting.get(workspaceId);

        if (inFlight)
            return inFlight;

        const wake = this.wakeAndAwait(workspaceId).finally(() => this.starting.delete(workspaceId));

        this.starting.set(workspaceId, wake);

        return wake;
    }

    /** One entry per wake in progress; absent means nothing is starting. */
    private readonly starting = new Map<Workspace.Id, Promise<void>>();

    private async wakeAndAwait(workspaceId: Workspace.Id): Promise<void> {
        if (await this.hardware.isServing(workspaceId))
            return;

        await this.start(workspaceId);

        await this.hardware.awaitHealthy(workspaceId);
    }

    async start(workspaceId: Workspace.Id): Promise<void> {
        await this.ensureCompute(workspaceId);

        return this.runTransition(workspaceId, 'start', () => this.hardware.startBackend(workspaceId));
    }

    /**
     * Gives the machines back while keeping everything the workspace is. Its
     * database, hostnames and secrets stay; the next request rebuilds compute.
     */
    async reclaimCompute(workspaceId: Workspace.Id): Promise<void> {
        await this.stop(workspaceId);

        await this.hardware.destroy(workspaceId);

        this.router.invalidate(workspaceId);
    }

    /**
     * Rebuilds the machines of a workspace whose compute was given back while
     * it went unused. Its data was never on them, so this is a slow start
     * rather than a restore.
     */
    private async ensureCompute(workspaceId: Workspace.Id): Promise<void> {
        if (await this.hardware.exists(workspaceId))
            return;

        const row = await PortalDB.asService('read workspace to rebuild compute', (db) =>
            db.selectFrom('workspaces').select(['owner_id', 'plan']).where('id', '=', workspaceId).executeTakeFirst());

        if (!row)
            return;

        this.logger.log(`Rebuilding reclaimed machines for ${workspaceId}`);

        await this.provisioning.rebuild(workspaceId, User.Id.parse(row.owner_id), Workspace.Plan.parse(row.plan));
    }

    /** Stopping means nothing is left running, worker included. */
    stop(workspaceId: Workspace.Id): Promise<void> {
        return this.runTransition(workspaceId, 'stop', () => this.hardware.stopAll(workspaceId));
    }

    suspend(workspaceId: Workspace.Id): Promise<void> {
        return this.runTransition(workspaceId, 'suspend', () => this.hardware.suspendBackend(workspaceId));
    }

    /** The waking half of suspend, and like `start`, the backend's alone. */
    resume(workspaceId: Workspace.Id): Promise<void> {
        return this.runTransition(workspaceId, 'resume', () => this.hardware.startBackend(workspaceId));
    }

    /** Everything down, then answerable again. The worker returns on demand. */
    restart(workspaceId: Workspace.Id): Promise<void> {
        return this.runTransition(workspaceId, 'restart', () => this.hardware.restartAll(workspaceId));
    }

    /**
     * What every transition shares: the machines move, the router stops trusting
     * a route that may now point at something down, and subscribers hear about
     * it either way.
     */
    private async runTransition(
        workspaceId: Workspace.Id,
        action:      Fleet.Machine.LifecycleAction,
        apply:       () => Promise<void>,
    ): Promise<void> {
        // Announced before the work starts and written nowhere: a transition is
        // not a state the machine can be in, so the row keeps saying what the
        // driver last reported until this settles.
        this.emit(workspaceId, Workspace.Event.create('transition:started', { action }));

        try {
            await apply();

            this.router.invalidate(workspaceId);
        }
        finally {
            // In `finally`, so a failed transition still reports where it left
            // the machines. Its own try: the settle must not replace the error
            // that caused it.
            try {
                const states = await this.hardware.getStates([workspaceId]);

                this.emit(workspaceId, Workspace.Event.create('state:changed', { state: states.get(workspaceId) ?? null }));
            }
            catch (error) {
                this.logger.error(`Could not read ${workspaceId} back after a transition: ${error instanceof Error ? error.message : error}`);
            }
        }
    }

    /**
     * What the machine actually ended up on, read back rather than inferred from
     * the action. Runs on the failure path too — a transition that threw still
     * has to clear the card, or it spins forever.
     *
     * Its own errors are swallowed: this runs in a `finally`, and a throw here
     * would replace whatever went wrong with a read failure.
     */

    /**
     * Moves a workspace to another plan and rebuilds its compute to match. The
     * plan is written first: the topology is derived from it, so a conversion
     * that fails leaves the intent recorded for a retry.
     */
    /**
     * Rebuilds the machines from the spec as it stands now — a new image, or a
     * changed environment, reaches an existing workspace this way. Its database,
     * hostnames and secrets are untouched; only the compute is replaced.
     */
    async rebuild(workspaceId: Workspace.Id, ownerId: User.Id, plan: Workspace.Plan): Promise<void> {
        // Down for the rebuild: stopped first so executions end and pools close.
        await this.stop(workspaceId);

        await this.provisioning.rebuild(workspaceId, ownerId, plan);

        await this.start(workspaceId);

        await this.hardware.awaitHealthy(workspaceId);

        this.router.invalidate(workspaceId);
    }

    async setPlan(workspaceId: Workspace.Id, ownerId: User.Id, plan: Workspace.Plan): Promise<void> {
        await PortalDB.asService('set workspace plan', (db) =>
            db.updateTable('workspaces').set({ plan }).where('id', '=', workspaceId).execute());

        // A conversion rebuilds the machines, so the workspace goes down for it:
        // stopped first so executions end and pools close, started again once
        // the new topology exists.
        await this.stop(workspaceId);

        await this.provisioning.convert(workspaceId, ownerId, plan);

        await this.start(workspaceId);

        await this.hardware.awaitHealthy(workspaceId);

        this.router.invalidate(workspaceId);
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
