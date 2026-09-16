import { ConflictException, ForbiddenException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Plan, Fleet, User, Workspace } from '@pretzel-cloud/shared/domain';
import { PermissionService } from '@/services/Permission/permission.service';
import { PlanRegistry } from '@/services/Plan/plan.registry';
import { LockService } from '@/services/Locking/lock.service';
import { Operation } from '@/decorators/operation';
import { ListingService } from '@/services/Listing/listing.service';
import { WorkspaceRepository } from './workspace.repository';
import { UserRepository } from '@/services/User/user.repository';
import { ProvisioningService } from '@/services/Fleet/provisioning/provisioning.service';
import { HardwareService, TopologyNotRestored } from '@/services/Fleet/Hardware/hardware.service';
import { ReleaseService } from '@/services/Fleet/Release/release.service';
import { HostnameService } from '@/services/Fleet/Hostname/hostname.service';
import { Principal } from '@/auth/identity/principal';
import { Router } from '@/services/SiloRouter/router.service';
import { RealtimeService } from '@/services/Realtime/realtime.service';
import { EntitlementService } from '@/services/Entitlement/entitlement.service';

const createEvent = Workspace.Event.create;
import { BillingService } from '@/services/Billing/billing.service';


const DEFAULT_MAX_WORKSPACES_PER_OWNER = 1;

/** Read per call; a value that is not a whole number fails loudly rather than lifting the cap. */
function maxWorkspacesPerOwner(): number {
    const raw = process.env.MAX_WORKSPACES_PER_OWNER;

    if (!raw)
        return DEFAULT_MAX_WORKSPACES_PER_OWNER;

    const value = Number(raw);

    if (!Number.isInteger(value) || value < 0)
        throw new Error(`MAX_WORKSPACES_PER_OWNER must be a whole number, got "${raw}"`);

    return value;
}

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
        private readonly provisioning:        ProvisioningService,
        private readonly hardware:            HardwareService,
        private readonly hostname:            HostnameService,
        private readonly siloRouter:          Router,
        private readonly realtime:            RealtimeService,
        private readonly entitlement:         EntitlementService,
        private readonly repository:          WorkspaceRepository,
        private readonly userRepository:      UserRepository,
        private readonly permission:          PermissionService,
        private readonly listing:             ListingService,
        @Inject(forwardRef(() => BillingService))
        private readonly billing:             BillingService,
        private readonly planRegistry:        PlanRegistry,
        private readonly release:             ReleaseService,
        // Read by `@Operation`, which serialises a workspace's operations across instances.
        private readonly lockService:         LockService,
        ) {}

    /** A flat cap per account, whatever its plan — a number, not a plan property, until the downgrade story is settled. */
    private async refuseOverOwnerCap(ownerId: User.Id): Promise<void> {
        const cap = maxWorkspacesPerOwner();

        const owned = await this.repository.countByOwner(Principal.SELF, ownerId);

        if (owned < cap)
            return;

        if (cap === 1)
            throw new ForbiddenException('Accounts include one workspace for now. Destroy yours to create another.');

        throw new ForbiddenException(`Accounts include ${cap} workspaces for now. Destroy one to create another.`);
    }

    /** Addressing is derived here: a caller cannot address another tenant's channel. */
    private emit(workspaceId: Workspace.Id, event: Workspace.Event.Unstamped): void {
        const channel = Workspace.Event.getChannel(workspaceId);

        this.realtime.publish(channel, { ...event, channel, workspaceId });
    }


    // Account creation and deletion cannot cross while ownership is being written.
    @Operation('account')
    public async create(principal: Principal.User, displayName: string, region: Fleet.Region.Schema): Promise<Workspace> {
        const id = Workspace.createId();

        const owner = await this.userRepository.get(Principal.SELF, principal.userId);

        if (!owner)
            throw new NotFoundException('No profile yet');

        await this.refuseOverOwnerCap(principal.userId);

        // Both rows or neither: no membership row means the owner cannot see it.
        const workspace = await this.repository.insert(Principal.SELF, { id, displayName, ownerId: principal.userId });

        void (async () => {
            try {
                await this.provisioning.provision(id, owner, Plan.DEFAULT_PLAN_ID, region);
            }
            catch (error) {
                this.logger.error(`Provisioning ${id} failed: ${error instanceof Error ? error.message : error}`);

                await this.abandonCreation(id);

                return;
            }

            // A probe before now cached the absence.
            this.siloRouter.invalidate(id);

            await this.setLifecycleState(id, 'running');
        })().catch((error: unknown) => this.logger.error(
            `Creating ${id} failed: ${error instanceof Error ? error.message : error}`,
        ));

        return workspace;
    }

    // What the router says after it woke a machine itself.
    public async markRunning(workspaceId: Workspace.Id): Promise<void> {
        await this.setLifecycleState(workspaceId, 'running');
    }

    /** Writes the state and tells anyone watching. */
    private async setLifecycleState(
        id:             Workspace.Id,
        lifecycleState: Workspace.Lifecycle.State,
        { emitNoEvents }: Workspace.Lifecycle.TransitionOptions = {},
    ): Promise<Workspace> {
        const workspace = await this.repository.setLifecycleState(Principal.SELF, id, lifecycleState);

        this.siloRouter.invalidateLifecycle(id);

        if (!emitNoEvents)
            this.emit(id, createEvent('lifecycle:changed', { lifecycleState }));

        return workspace;
    }

    /**
     * Gives back what a failed build left behind. The row survives either way —
     * the owner retries it, or destroys it — and `abandoned_at` records that the
     * fleet may still be holding something.
     */
    private async abandonCreation(id: Workspace.Id): Promise<void> {
        try {
            await this.provisioning.deprovision(id);

            this.siloRouter.invalidate(id);
        }
        catch (error) {
            this.logger.error(`Teardown of ${id} failed, leaving it for the sweep: ${error instanceof Error ? error.message : error}`);

            await this.repository.setAbandoned(Principal.SELF, id);
        }

        await this.setLifecycleState(id, 'provisioning_failed');
    }

    public async list(principal: Principal.User): Promise<Workspace[]> {
        const workspaces = await this.permission.getWorkspacesForMember(principal);

        // Filled here rather than mapped: where it lives and what it runs are the fleet's facts, on its own credential.
        const placementByWorkspaceId = await this.hardware.getPlacementForWorkspaces(workspaces.map((workspace) => workspace.id));

        return workspaces.map((workspace) => {
            const placement = placementByWorkspaceId.get(workspace.id);

            return {
                ...workspace,
                region:      placement?.region ?? null,
                releaseId:   placement?.releaseId ?? null,
                releaseName: placement?.releaseName ?? null,
            };
        });
    }

    public async get(workspaceId: Workspace.Id): Promise<Workspace> {
        return this.repository.get(Principal.SELF, workspaceId);
    }

    /** The name on the account. Ownership was settled by the guard. */
    public async rename(principal: Principal.User, workspaceId: Workspace.Id, displayName: string): Promise<void> {
        await this.repository.setDisplayName(principal, workspaceId, displayName);
    }

    /**
     * Paid plans only. The canonical host is untouched, so URLs already handed out
     * keep resolving. The database settles uniqueness — checking first would race.
     */
    public async setSubdomain(principal: Principal.User, workspace: Workspace, subdomain: Workspace.Subdomain | null): Promise<void> {
        if (!Plan.isPaid(workspace.plan))
            throw new ForbiddenException('A custom subdomain requires a paid plan');

        try {
            await this.repository.setSubdomain(principal, workspace.id, subdomain);
        }
        catch (error) {
            if (error instanceof Error && error.message.includes('workspaces_subdomain_key'))
                throw new ConflictException('That subdomain is taken');

            throw error;
        }

        await this.hostname.setCustom(workspace.id, subdomain);

        this.siloRouter.invalidate(workspace.id, [workspace.subdomain, subdomain]);
    }




    /**
     * Wakes the worker so it can drain the queue. Called by the workspace's own
     * backend before it enqueues, which is the only moment anything knows work
     * is coming.
     */
    public wakeWorker(workspaceId: Workspace.Id): Promise<void> {
        return this.hardware.lifecycle.startWorker(workspaceId);
    }




    /** Stops the worker once its backend reports the queue has been quiet. */
    public sleepWorker(workspaceId: Workspace.Id): Promise<void> {
        return this.hardware.lifecycle.stopWorker(workspaceId);
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

        const isWakeable = Workspace.Lifecycle.isWakeable(lifecycleState)

        // Already up: the cached address may still say otherwise.
        if (lifecycleState === 'running' || (isWakeable && await this.hardware.state.isServing(workspaceId))) {
            this.siloRouter.invalidateAddress(workspaceId);

            return;
        }

        if (!Workspace.Lifecycle.isWakeable(lifecycleState))
            throw new ConflictException(`This workspace is ${lifecycleState}`);

        await this.start(workspaceId);
    }




    /** The fleet turning it off. Only `enable` undoes it. */
    public async disable(workspaceId: Workspace.Id, reason: string): Promise<void> {
        await this.repository.setDisabled(Principal.SELF, workspaceId, reason);

        this.emit(workspaceId, createEvent('lifecycle:changed', { lifecycleState: 'disabled' }));

        this.siloRouter.invalidate(workspaceId);

        // Not a transition: `stop` would land it on `stopped`, and which of the
        // two it is decides who may start it again.
        await this.hardware.lifecycle.stopAll(workspaceId);
    }




    /** Left running rather than started: it comes back on the next request. */
    public async enable(workspaceId: Workspace.Id): Promise<void> {
        const { lifecycleState } = await this.get(workspaceId);

        if (lifecycleState !== 'disabled')
            return;

        await this.repository.clearDisabled(Principal.SELF, workspaceId);

        this.emit(workspaceId, createEvent('lifecycle:changed', { lifecycleState: 'sleeping' }));

        this.siloRouter.invalidate(workspaceId);
    }




    @Operation('workspace')
    public async start(workspaceId: Workspace.Id, options: Workspace.Lifecycle.TransitionOptions = {}): Promise<void> {
        await this.ensureCompute(workspaceId);

        return this.runTransition(workspaceId, 'start', options);
    }




    /** Gives the machines back. Hardware row, database, hostnames and secrets stay, and traffic rebuilds it. */
    @Operation('workspace')
    public async reclaimCompute(workspaceId: Workspace.Id): Promise<void> {
        // Quiet: the state announced is `sleeping` below, not the `stopped` a stop lands on.
        await this.stop(workspaceId, { emitNoEvents: true });

        await this.hardware.destroyCompute(workspaceId);

        await this.setLifecycleState(workspaceId, 'sleeping');

        this.siloRouter.invalidate(workspaceId);
    }

    /** Rebuilds reclaimed machines. Data was never on them, so this is a slow start. */
    private async ensureCompute(workspaceId: Workspace.Id): Promise<void> {
        if (await this.hardware.state.hasMachines(workspaceId))
            return;

        const row = await this.repository.getOwnerAndPlanIdForWorkspace(Principal.SELF, workspaceId);

        if (!row)
            return;

        this.logger.log(`Rebuilding reclaimed machines for ${workspaceId}`);

        const ownerId = row.owner_id as User.Id
        const planId  = row.plan_id as Plan.Id

        await this.provisioning.rebuild(workspaceId, ownerId, planId);
    }




    /** Stopping means nothing is left running, worker included. */
    @Operation('workspace')
    public stop(workspaceId: Workspace.Id, options: Workspace.Lifecycle.TransitionOptions = {}): Promise<void> {
        return this.runTransition(workspaceId, 'stop', options);
    }




    @Operation('workspace')
    public suspend(workspaceId: Workspace.Id, options: Workspace.Lifecycle.TransitionOptions = {}): Promise<void> {
        return this.runTransition(workspaceId, 'suspend', options);
    }




    /** Everything down, then answerable again. The worker returns on demand. */
    @Operation('workspace')
    public restart(workspaceId: Workspace.Id, options: Workspace.Lifecycle.TransitionOptions = {}): Promise<void> {
        return this.runTransition(workspaceId, 'restart', options);
    }




    /** What every transition shares: machines move, route drops, subscribers hear. */
    private async runTransition(
        workspaceId: Workspace.Id,
        action:      Workspace.Lifecycle.Action,
        { emitNoEvents }: Workspace.Lifecycle.TransitionOptions = {},
    ): Promise<void> {
        // Written nowhere: a transition is not a state a workspace can be in.
        if (!emitNoEvents)
            this.emit(workspaceId, createEvent('transition:started', { action }));

        try {
            switch (action) {
                case 'start':   await this.hardware.lifecycle.startBackend(workspaceId);   break;
                case 'stop':    await this.hardware.lifecycle.stopAll(workspaceId);        break;
                case 'suspend': await this.hardware.lifecycle.suspendBackend(workspaceId); break;
                case 'restart': await this.hardware.lifecycle.restartAll(workspaceId);     break;
            }
            // Recorded only once it answers: an action that brings a workspace up
            // is not done when the machines are told, and a row saying `running`
            // in the meantime is one the siloRouter forwards into.
            if (action === 'start' || action === 'restart')
                await this.hardware.lifecycle.awaitHealthy(workspaceId);

            this.siloRouter.invalidate(workspaceId);

            // Written either way, only unannounced: a caller that dies partway
            // leaves a row saying what the machines are, not what they were.
            await this.setLifecycleState(workspaceId, Workspace.Lifecycle.getStateFromAction(action), { emitNoEvents });
        }
        catch (error) {
            if (!emitNoEvents) {
                // Said first, because the state below is unchanged and on its own
                // reads as nothing having happened — which is all a caller that is
                // not waiting for an answer would otherwise see.
                this.emit(workspaceId, createEvent('transition:failed', {
                    action,
                    reason: error instanceof Error ? error.message : String(error),
                }));

                const { lifecycleState } = await this.get(workspaceId);

                this.emit(workspaceId, createEvent('lifecycle:changed', { lifecycleState }));
            }

            throw error;
        }
    }




    /**
     * Replaces the compute from the current spec. Data, hostnames and secrets
     * stay. The machines are destroyed rather than moved, so this announces
     * itself and the transitions inside it stay quiet.
     */
    @Operation('workspace')
    public async rebuild(workspaceId: Workspace.Id, ownerId: User.Id, planId: Plan.Id): Promise<void> {
        this.emit(workspaceId, createEvent('rebuild:started', {}));

        try {
            // Down for the rebuild: stopped first so executions end and pools close.
            await this.stop(workspaceId, { emitNoEvents: true });

            await this.provisioning.rebuild(workspaceId, ownerId, planId);

            await this.start(workspaceId, { emitNoEvents: true });
        }
        catch (error) {
            this.emit(workspaceId, createEvent('rebuild:failed', {
                reason: error instanceof Error ? error.message : String(error),
            }));

            // Wherever the halves left it, which they wrote and did not say.
            const { lifecycleState } = await this.get(workspaceId);

            this.emit(workspaceId, createEvent('lifecycle:changed', { lifecycleState }));

            throw error;
        }

        this.siloRouter.invalidate(workspaceId);

        this.emit(workspaceId, createEvent('lifecycle:changed', { lifecycleState: 'running' }));

        this.emit(workspaceId, createEvent('rebuild:succeeded', {}));
    }




    /** Moves the pin to the named release and replaces the machines from it. */
    @Operation('workspace')
    public async updateToRelease(workspaceId: Workspace.Id, ownerId: User.Id, planId: Plan.Id, releaseId: Fleet.Release.Id): Promise<void> {
        // Fetched before pinning: a release that does not exist is refused here.
        const target = await this.release.getById(releaseId);

        this.emit(workspaceId, createEvent('update:started', { releaseId: target.id, releaseName: target.name }));

        try {
            await this.hardware.setRelease(workspaceId, target.id);

            // Down for the swap: stopped first so executions end and pools close.
            await this.stop(workspaceId, { emitNoEvents: true });

            // Its own state for the window: not stopped, coming back on its own.
            await this.repository.setLifecycleState(Principal.SELF, workspaceId, 'updating');

            this.emit(workspaceId, createEvent('lifecycle:changed', { lifecycleState: 'updating' }));

            await this.provisioning.rebuild(workspaceId, ownerId, planId);

            await this.start(workspaceId, { emitNoEvents: true });
        }
        catch (error) {
            this.emit(workspaceId, createEvent('update:failed', {
                releaseName: target.name,
                reason:      error instanceof Error ? error.message : String(error),
            }));

            // An update that died in its window must not stay 'updating' forever.
            const { lifecycleState } = await this.get(workspaceId);

            if (lifecycleState === 'updating') {
                await this.repository.setLifecycleState(Principal.SELF, workspaceId, 'stopped');

                this.emit(workspaceId, createEvent('lifecycle:changed', { lifecycleState: 'stopped' }));
            }
            else
                this.emit(workspaceId, createEvent('lifecycle:changed', { lifecycleState }));

            throw error;
        }

        this.siloRouter.invalidate(workspaceId);

        this.emit(workspaceId, createEvent('lifecycle:changed', { lifecycleState: 'running' }));

        this.emit(workspaceId, createEvent('update:succeeded', { releaseId: target.id, releaseName: target.name }));
    }




    @Operation('workspace')
    public async setPlan(workspaceId: Workspace.Id, ownerId: User.Id, planId: Plan.Id): Promise<void> {
        await this.repository.setPlan(Principal.SELF, workspaceId, planId);

        // Before the rebuild: what was bought is already true.
        this.emit(workspaceId, createEvent('plan:changed', { plan: this.planRegistry.get(planId) }));

        // A bigger plan takes effect now, not at the next re-check.
        this.entitlement.unlock(workspaceId);

        // Down for the conversion, so executions end and pools close.
        await this.stop(workspaceId);

        try {
            await this.provisioning.convert(workspaceId, ownerId, planId);
        }
        catch (error) {
            // Only when its machines could not be put back. A conversion that
            // failed and rolled back leaves a working workspace, and freezing it
            // for that would take away what the owner already had.
            if (isTopologyNotRestored(error))
                await this.disable(workspaceId, 'Its machines could not be rebuilt after a failed plan change.');

            this.siloRouter.invalidate(workspaceId);

            throw error;
        }

        await this.start(workspaceId);

        this.siloRouter.invalidate(workspaceId);
    }




    /** Tears a workspace down with no ownership check; callers settle who may first. */
    @Operation('workspace', 1)
    public async destroy(principal: Principal.User | Principal.Service, workspace: Workspace): Promise<void> {
        const { id: workspaceId, subdomain } = workspace;

        this.emit(workspaceId, createEvent('destroy:started', {}));

        try {
            if (workspace.lifecycleState === 'creating')
                throw new ConflictException('This workspace is still being created. Retry when provisioning finishes.');

            await this.billing.cancelSubscription(workspaceId);

            this.permission.invalidateCloudToken(workspaceId);

            await this.provisioning.deprovision(workspaceId);

            await this.listing.deleteAllForWorkspace(workspaceId);

            await this.repository.delete(principal, workspaceId);
        }
        catch (error) {
            this.emit(workspaceId, createEvent('destroy:failed', {
                reason: error instanceof Error ? error.message : String(error),
            }));

            throw error;
        }

        // After the row goes, so the refill finds nothing.
        this.siloRouter.invalidate(workspaceId, [subdomain]);

        this.emit(workspaceId, createEvent('destroyed'));
    }
}
