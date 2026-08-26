import { ConflictException, ForbiddenException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Fleet, User, Workspace } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';
import { PermissionService } from '@/services/Permission/permission.service';
import { ListingService } from '@/services/Listing/listing.service';
import { WorkspaceDatabase } from './workspace.database';
import { UserDatabase } from '@/services/User/user.database';
import { ProvisioningService } from '@/services/Fleet/provisioning/provisioning.service';
import { HardwareService, TopologyNotRestored } from '@/services/Fleet/Hardware/hardware.service';
import { HostnameService } from '@/services/Fleet/Hostname/hostname.service';
import { Principal } from '@/auth/identity/principal';
import { Router } from '@/services/WorkspaceRouter/router.service';
import { RealtimeService } from '@/services/Realtime/realtime.service';
import { EntitlementService } from '@/services/Entitlement/entitlement.service';
import { BillingService } from '@/services/Billing/billing.service';

const PROVISION_ATTEMPTS = 3;

/** Unwraps the provisioner's wrapper to ask what actually went wrong underneath. */
function isTopologyNotRestored(error: unknown): boolean {
    if (error instanceof TopologyNotRestored)
        return true;

    return error instanceof Error && error.cause instanceof TopologyNotRestored;
}

@Injectable()
export class WorkspaceService {

    private readonly logger = new Logger(WorkspaceService.name);

    constructor(
        private readonly provisioningService: ProvisioningService,
        private readonly hardwareService: HardwareService,
        private readonly hostnameService: HostnameService,
        private readonly router: Router,
        private readonly realtimeService: RealtimeService,
        private readonly entitlementService: EntitlementService,
        private readonly workspaceDatabase: WorkspaceDatabase,
        private readonly userDatabase: UserDatabase,
        private readonly permissionService: PermissionService,
        private readonly listingService: ListingService,
        @Inject(forwardRef(() => BillingService))
        private readonly billingService: BillingService,
    ) {}

    /** Addressing is derived here: a caller cannot address another tenant's channel. */
    private emit(workspaceId: Workspace.Id, event: Workspace.Event.Unstamped): void {
        const channel = Workspace.Event.getChannel(workspaceId);

        this.realtimeService.publish(channel, { ...event, channel, workspaceId });
    }

    /**
     * The id is minted first and every step keyed by it, so a killed run can be
     * repeated. The row is written before anything is built — a machine nobody
     * has a record of is the expensive orphan. A build that cannot be finished
     * leaves the row in `provisioning_failed` for the owner to retry, keyed by
     * the same id, so the retry reuses its database and role names.
     */
    public async create(principal: Principal.User, displayName: string): Promise<Workspace> {
        const id = Workspace.createId();

        // Both rows or neither: no membership row means the owner cannot see it.
        const owner = await PortalDB.asService('create workspace', async (trx) => {
            await this.workspaceDatabase.insert(trx, { id, displayName, ownerId: principal.userId });

            // Read here so a missing profile fails before anything is built,
            // rather than partway through provisioning.
            const owner = await this.userDatabase.get(trx, principal.userId);

            if (!owner)
                throw new NotFoundException('No profile yet');

            return owner;
        });

        for (let attempt = 1; attempt <= PROVISION_ATTEMPTS; attempt++) {
            try {
                await this.provisioningService.provision(id, owner, 'free');

                // Its hostnames were unknown until a moment ago, and a probe in
                // that window would have cached the absence.
                this.router.invalidate(id);

                return this.setLifecycleState(id, 'running');
            }
            catch (error) {
                this.logger.error(`Provisioning ${id} failed (attempt ${attempt}/${PROVISION_ATTEMPTS}): ${error instanceof Error ? error.message : error}`);
            }
        }

        await this.abandon(id);

        throw new Error('Could not create workspace');
    }

    /** Writes the state and tells anyone watching. */
    private async setLifecycleState(id: Workspace.Id, lifecycleState: Workspace.LifecycleState): Promise<Workspace> {
        const workspace = await PortalDB.asService('set workspace lifecycle state', (trx) =>
            this.workspaceDatabase.setLifecycleState(trx, id, lifecycleState));

        this.emit(id, Workspace.Event.create('lifecycle:changed', { lifecycleState }));

        return workspace;
    }

    /**
     * Gives back what a failed build left behind. The row survives either way —
     * the owner retries it, or destroys it — and `abandoned_at` records that the
     * fleet may still be holding something.
     */
    private async abandon(id: Workspace.Id): Promise<void> {
        try {
            await this.provisioningService.deprovision(id);

            this.router.invalidate(id);
        }
        catch (error) {
            this.logger.error(`Teardown of ${id} failed, leaving it for the sweep: ${error instanceof Error ? error.message : error}`);

            await PortalDB.asService('flag abandoned workspace', (trx) => this.workspaceDatabase.setAbandoned(trx, id));
        }

        await this.setLifecycleState(id, 'provisioning_failed');
    }

    public async list(principal: Principal.User): Promise<Workspace[]> {
        return this.permissionService.getWorkspacesForMember(principal);
    }

    public async get(workspaceId: Workspace.Id): Promise<Workspace> {
        return PortalDB.asService('read workspace', (trx) => this.workspaceDatabase.get(trx, workspaceId));
    }

    /** The name on the account. Ownership was settled by the guard. */
    public async rename(principal: Principal.User, workspaceId: Workspace.Id, displayName: string): Promise<void> {
        await PortalDB.asUser(principal, (trx) => this.workspaceDatabase.setDisplayName(trx, workspaceId, displayName));
    }

    /**
     * Paid plans only. The canonical host is untouched, so URLs already handed out
     * keep resolving. The database settles uniqueness — checking first would race.
     */
    public async setSubdomain(principal: Principal.User, workspace: Workspace, subdomain: Workspace.Subdomain | null): Promise<void> {
        if (!Workspace.isPaid(workspace.plan))
            throw new ForbiddenException('A custom subdomain requires a paid plan');

        try {
            await PortalDB.asUser(principal, (trx) => this.workspaceDatabase.setSubdomain(trx, workspace.id, subdomain));
        }
        catch (error) {
            if (error instanceof Error && error.message.includes('workspaces_subdomain_key'))
                throw new ConflictException('That subdomain is taken');

            throw error;
        }

        await this.hostnameService.setCustom(workspace.id, subdomain);

        this.router.invalidate(workspace.id, [workspace.subdomain, subdomain]);
    }

    /**
     * Wakes the worker so it can drain the queue. Called by the workspace's own
     * backend before it enqueues, which is the only moment anything knows work
     * is coming.
     */
    public wakeWorker(workspaceId: Workspace.Id): Promise<void> {
        return this.hardwareService.startWorker(workspaceId);
    }

    /** Stops the worker once its backend reports the queue has been quiet. */
    public sleepWorker(workspaceId: Workspace.Id): Promise<void> {
        return this.hardwareService.stopWorker(workspaceId);
    }

    /** The one place the wake rule lives, so every trigger path inherits it. */
    public ensureStarted(workspaceId: Workspace.Id): Promise<void> {
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
        const { lifecycleState } = await this.get(workspaceId);

        if (lifecycleState === 'running')
            return;

        if (!Workspace.isWakeable(lifecycleState))
            throw new ConflictException(`This workspace is ${lifecycleState}`);

        if (await this.hardwareService.isServing(workspaceId))
            return;

        await this.start(workspaceId);
    }

    /** The fleet turning it off. Only `unfreeze` undoes it. */
    public async freeze(workspaceId: Workspace.Id, reason: string): Promise<void> {
        await PortalDB.asService('freeze workspace', (trx) => this.workspaceDatabase.setFrozen(trx, workspaceId, reason));

        this.emit(workspaceId, Workspace.Event.create('lifecycle:changed', { lifecycleState: 'frozen' }));

        this.router.invalidate(workspaceId);

        // Not a transition: `stop` would land it on `stopped`, and which of the
        // two it is decides who may start it again.
        await this.hardwareService.stopAll(workspaceId);
    }

    /** Left running rather than started: it comes back on the next request. */
    public async unfreeze(workspaceId: Workspace.Id): Promise<void> {
        const { lifecycleState } = await this.get(workspaceId);

        if (lifecycleState !== 'frozen')
            return;

        await PortalDB.asService('unfreeze workspace', (trx) => this.workspaceDatabase.clearFrozen(trx, workspaceId));

        this.emit(workspaceId, Workspace.Event.create('lifecycle:changed', { lifecycleState: 'sleeping' }));

        this.router.invalidate(workspaceId);
    }

    public async start(workspaceId: Workspace.Id): Promise<void> {
        // Only `unfreeze` leaves that state, so no start path can.
        if ((await this.get(workspaceId)).lifecycleState === 'frozen')
            throw new ForbiddenException('This workspace is frozen');

        await this.ensureCompute(workspaceId);

        return this.runTransition(workspaceId, 'start');
    }

    /** Gives the machines back. Database, hostnames and secrets stay. */
    public async reclaimCompute(workspaceId: Workspace.Id): Promise<void> {
        await this.stop(workspaceId);

        await this.hardwareService.destroy(workspaceId);

        this.router.invalidate(workspaceId);
    }

    /** Rebuilds reclaimed machines. Data was never on them, so this is a slow start. */
    private async ensureCompute(workspaceId: Workspace.Id): Promise<void> {
        if (await this.hardwareService.hasMachines(workspaceId))
            return;

        const row = await PortalDB.asService('read workspace to rebuild compute', (trx) =>
            this.workspaceDatabase.getSpecInputs(trx, workspaceId));

        if (!row)
            return;

        this.logger.log(`Rebuilding reclaimed machines for ${workspaceId}`);

        await this.provisioningService.rebuild(workspaceId, User.Id.parse(row.owner_id), Workspace.Plan.parse(row.plan));
    }

    /** Stopping means nothing is left running, worker included. */
    public stop(workspaceId: Workspace.Id): Promise<void> {
        return this.runTransition(workspaceId, 'stop');
    }

    public suspend(workspaceId: Workspace.Id): Promise<void> {
        return this.runTransition(workspaceId, 'suspend');
    }

    /** Everything down, then answerable again. The worker returns on demand. */
    public restart(workspaceId: Workspace.Id): Promise<void> {
        return this.runTransition(workspaceId, 'restart');
    }

    /** What every transition shares: machines move, route drops, subscribers hear. */
    private async runTransition(workspaceId: Workspace.Id, action: Workspace.LifecycleAction): Promise<void> {
        // Written nowhere: a transition is not a state a workspace can be in.
        this.emit(workspaceId, Workspace.Event.create('transition:started', { action }));

        try {
            switch (action) {
                case 'start':   await this.hardwareService.startBackend(workspaceId);   break;
                case 'stop':    await this.hardwareService.stopAll(workspaceId);        break;
                case 'suspend': await this.hardwareService.suspendBackend(workspaceId); break;
                case 'restart': await this.hardwareService.restartAll(workspaceId);     break;
            }

            // Recorded only once it answers: an action that brings a workspace up
            // is not done when the machines are told, and a row saying `running`
            // in the meantime is one the router forwards into.
            if (action === 'start' || action === 'restart')
                await this.hardwareService.awaitHealthy(workspaceId);

            this.router.invalidate(workspaceId);

            await this.setLifecycleState(workspaceId, Workspace.getLifecycleStateFromAction(action));
        }
        catch (error) {
            // The machines did not get there, so the row still holds what it
            // did. Say so, or the client waits on a transition that is over.
            await this.emitStoredLifecycleState(workspaceId);

            throw error;
        }
    }

    private async emitStoredLifecycleState(workspaceId: Workspace.Id): Promise<void> {
        try {
            const { lifecycleState } = await this.get(workspaceId);

            this.emit(workspaceId, Workspace.Event.create('lifecycle:changed', { lifecycleState }));
        }
        catch (error) {
            this.logger.error(`Could not read ${workspaceId} back after a failed transition: ${error instanceof Error ? error.message : error}`);
        }
    }

    /** Replaces the compute from the current spec. Data, hostnames and secrets stay. */
    public async rebuild(workspaceId: Workspace.Id, ownerId: User.Id, plan: Workspace.Plan): Promise<void> {
        // Down for the rebuild: stopped first so executions end and pools close.
        await this.stop(workspaceId);

        await this.provisioningService.rebuild(workspaceId, ownerId, plan);

        await this.start(workspaceId);

        this.router.invalidate(workspaceId);
    }

    public async setPlan(workspaceId: Workspace.Id, ownerId: User.Id, plan: Workspace.Plan): Promise<void> {
        await PortalDB.asService('set workspace plan', (trx) => this.workspaceDatabase.setPlan(trx, workspaceId, plan));

        // Before the rebuild: what was bought is already true.
        this.emit(workspaceId, Workspace.Event.create('plan:changed', { plan }));

        // A bigger plan takes effect now, not at the next re-check.
        this.entitlementService.unlock(workspaceId);

        // Down for the conversion, so executions end and pools close.
        await this.stop(workspaceId);

        try {
            await this.provisioningService.convert(workspaceId, ownerId, plan);
        }
        catch (error) {
            // Only when its machines could not be put back. A conversion that
            // failed and rolled back leaves a working workspace, and freezing it
            // for that would take away what the owner already had.
            if (isTopologyNotRestored(error))
                await this.freeze(workspaceId, 'Its machines could not be rebuilt after a failed plan change.');

            this.router.invalidate(workspaceId);

            throw error;
        }

        await this.start(workspaceId);

        this.router.invalidate(workspaceId);
    }

    public async destroy(principal: Principal.User, workspaceId: Workspace.Id): Promise<void> {
        await this.billingService.cancelSubscription(workspaceId);

        this.permissionService.invalidateCloudToken(workspaceId);

        await this.provisioningService.deprovision(workspaceId);

        // Before the row goes: a cached route would otherwise keep answering for
        // a machine that no longer exists.
        this.router.invalidate(workspaceId);

        await this.listingService.deleteAllForWorkspace(workspaceId);

        await PortalDB.asUser(principal, (trx) => this.workspaceDatabase.delete(trx, workspaceId));

        this.emit(workspaceId, Workspace.Event.create('destroyed'));
    }
}
