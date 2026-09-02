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
        private readonly hardwareService:     HardwareService,
        private readonly hostnameService:     HostnameService,
        private readonly siloRouter:          Router,
        private readonly realtimeService:     RealtimeService,
        private readonly entitlementService:  EntitlementService,
        private readonly workspaceRepository: WorkspaceRepository,
        private readonly userRepository:      UserRepository,
        private readonly permissionService:   PermissionService,
        private readonly listingService:      ListingService,
        @Inject(forwardRef(() => BillingService))
        private readonly billingService:      BillingService,
        private readonly planRegistry:        PlanRegistry,
        private readonly releaseService:      ReleaseService,
        private readonly lockService:         LockService,
    ) {}

    /** Addressing is derived here: a caller cannot address another tenant's channel. */
    private emit(workspaceId: Workspace.Id, event: Workspace.Event.Unstamped): void {
        const channel = Workspace.Event.getChannel(workspaceId);

        this.realtimeService.publish(channel, { ...event, channel, workspaceId });
    }


    public async create(principal: Principal.User, displayName: string): Promise<Workspace> {
        const id = Workspace.createId();

        // Read first so a missing profile fails before anything is built.
        const owner = await this.userRepository.get(Principal.SELF, principal.userId);

        if (!owner)
            throw new NotFoundException('No profile yet');

        // Both rows or neither: no membership row means the owner cannot see it.
        const workspace = await this.workspaceRepository.insert(Principal.SELF, { id, displayName, ownerId: principal.userId });

        void (async () => {
            for (let attempt = 1; attempt <= PROVISION_ATTEMPTS; attempt++) {
                try {
                    await this.provisioningService.provision(id, owner, Plan.DEFAULT_PLAN_ID);

                    // A probe before now cached the absence.
                    this.siloRouter.invalidate(id);

                    return this.setLifecycleState(id, 'running');
                }
                catch (error) {
                    this.logger.error(`Provisioning ${id} failed (attempt ${attempt}/${PROVISION_ATTEMPTS}): ${error instanceof Error ? error.message : error}`);
                }
            }
            await this.abandonCreation(id);
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
        const workspace = await this.workspaceRepository.setLifecycleState(Principal.SELF, id, lifecycleState);

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
            await this.provisioningService.deprovision(id);

            this.siloRouter.invalidate(id);
        }
        catch (error) {
            this.logger.error(`Teardown of ${id} failed, leaving it for the sweep: ${error instanceof Error ? error.message : error}`);

            await this.workspaceRepository.setAbandoned(Principal.SELF, id);
        }

        await this.setLifecycleState(id, 'provisioning_failed');
    }

    public async list(principal: Principal.User): Promise<Workspace[]> {
        const workspaces = await this.permissionService.getWorkspacesForMember(principal);

        // Filled here rather than mapped: the release is the fleet's fact, on its own credential.
        const releaseInfoByWorkspaceId = await this.releaseService.getInfoForWorkspaces(workspaces.map((workspace) => workspace.id));

        return workspaces.map((workspace) => {
            const release = releaseInfoByWorkspaceId.get(workspace.id);

            return { ...workspace, releaseId: release?.id ?? null, releaseName: release?.name ?? null };
        });
    }

    public async get(workspaceId: Workspace.Id): Promise<Workspace> {
        return this.workspaceRepository.get(Principal.SELF, workspaceId);
    }

    /** The name on the account. Ownership was settled by the guard. */
    public async rename(principal: Principal.User, workspaceId: Workspace.Id, displayName: string): Promise<void> {
        await this.workspaceRepository.setDisplayName(principal, workspaceId, displayName);
    }

    /**
     * Paid plans only. The canonical host is untouched, so URLs already handed out
     * keep resolving. The database settles uniqueness — checking first would race.
     */
    public async setSubdomain(principal: Principal.User, workspace: Workspace, subdomain: Workspace.Subdomain | null): Promise<void> {
        if (!Plan.isPaid(workspace.plan))
            throw new ForbiddenException('A custom subdomain requires a paid plan');

        try {
            await this.workspaceRepository.setSubdomain(principal, workspace.id, subdomain);
        }
        catch (error) {
            if (error instanceof Error && error.message.includes('workspaces_subdomain_key'))
                throw new ConflictException('That subdomain is taken');

            throw error;
        }

        await this.hostnameService.setCustom(workspace.id, subdomain);

        this.siloRouter.invalidate(workspace.id, [workspace.subdomain, subdomain]);
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

        const isWakeable = Workspace.Lifecycle.isWakeable(lifecycleState)

        // Already up: the cached address may still say otherwise.
        if (lifecycleState === 'running' || (isWakeable && await this.hardwareService.isServing(workspaceId))) {
            this.siloRouter.invalidateAddress(workspaceId);

            return;
        }

        if (!Workspace.Lifecycle.isWakeable(lifecycleState))
            throw new ConflictException(`This workspace is ${lifecycleState}`);

        await this.start(workspaceId);
    }




    /** The fleet turning it off. Only `enable` undoes it. */
    public async disable(workspaceId: Workspace.Id, reason: string): Promise<void> {
        await this.workspaceRepository.setDisabled(Principal.SELF, workspaceId, reason);

        this.emit(workspaceId, createEvent('lifecycle:changed', { lifecycleState: 'disabled' }));

        this.siloRouter.invalidate(workspaceId);

        // Not a transition: `stop` would land it on `stopped`, and which of the
        // two it is decides who may start it again.
        await this.hardwareService.stopAll(workspaceId);
    }




    /** Left running rather than started: it comes back on the next request. */
    public async enable(workspaceId: Workspace.Id): Promise<void> {
        const { lifecycleState } = await this.get(workspaceId);

        if (lifecycleState !== 'disabled')
            return;

        await this.workspaceRepository.clearDisabled(Principal.SELF, workspaceId);

        this.emit(workspaceId, createEvent('lifecycle:changed', { lifecycleState: 'sleeping' }));

        this.siloRouter.invalidate(workspaceId);
    }




    @Operation()
    public async start(workspaceId: Workspace.Id, options: Workspace.Lifecycle.TransitionOptions = {}): Promise<void> {
        await this.ensureCompute(workspaceId);

        return this.runTransition(workspaceId, 'start', options);
    }




    /** Gives the machines back. Hardware row, database, hostnames and secrets stay, and traffic rebuilds it. */
    @Operation()
    public async reclaimCompute(workspaceId: Workspace.Id): Promise<void> {
        // Quiet: the state announced is `sleeping` below, not the `stopped` a stop lands on.
        await this.stop(workspaceId, { emitNoEvents: true });

        await this.hardwareService.destroyCompute(workspaceId);

        await this.setLifecycleState(workspaceId, 'sleeping');

        this.siloRouter.invalidate(workspaceId);
    }

    /** Rebuilds reclaimed machines. Data was never on them, so this is a slow start. */
    private async ensureCompute(workspaceId: Workspace.Id): Promise<void> {
        if (await this.hardwareService.hasMachines(workspaceId))
            return;

        const row = await this.workspaceRepository.getOwnerAndPlanIdForWorkspace(Principal.SELF, workspaceId);

        if (!row)
            return;

        this.logger.log(`Rebuilding reclaimed machines for ${workspaceId}`);

        const ownerId = row.owner_id as User.Id
        const planId  = row.plan_id as Plan.Id

        await this.provisioningService.rebuild(workspaceId, ownerId, planId);
    }




    /** Stopping means nothing is left running, worker included. */
    @Operation()
    public stop(workspaceId: Workspace.Id, options: Workspace.Lifecycle.TransitionOptions = {}): Promise<void> {
        return this.runTransition(workspaceId, 'stop', options);
    }




    @Operation()
    public suspend(workspaceId: Workspace.Id, options: Workspace.Lifecycle.TransitionOptions = {}): Promise<void> {
        return this.runTransition(workspaceId, 'suspend', options);
    }




    /** Everything down, then answerable again. The worker returns on demand. */
    @Operation()
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
                case 'start':   await this.hardwareService.startBackend(workspaceId);   break;
                case 'stop':    await this.hardwareService.stopAll(workspaceId);        break;
                case 'suspend': await this.hardwareService.suspendBackend(workspaceId); break;
                case 'restart': await this.hardwareService.restartAll(workspaceId);     break;
            }
            // Recorded only once it answers: an action that brings a workspace up
            // is not done when the machines are told, and a row saying `running`
            // in the meantime is one the siloRouter forwards into.
            if (action === 'start' || action === 'restart')
                await this.hardwareService.awaitHealthy(workspaceId);

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
    @Operation()
    public async rebuild(workspaceId: Workspace.Id, ownerId: User.Id, planId: Plan.Id): Promise<void> {
        this.emit(workspaceId, createEvent('rebuild:started', {}));

        try {
            // Down for the rebuild: stopped first so executions end and pools close.
            await this.stop(workspaceId, { emitNoEvents: true });

            await this.provisioningService.rebuild(workspaceId, ownerId, planId);

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
    @Operation()
    public async updateToRelease(workspaceId: Workspace.Id, ownerId: User.Id, planId: Plan.Id, releaseId: Fleet.Release.Id): Promise<void> {
        // Fetched before pinning: a release that does not exist is refused here.
        const release = await this.releaseService.getById(releaseId);

        this.emit(workspaceId, createEvent('update:started', { releaseId: release.id, releaseName: release.name }));

        try {
            await this.hardwareService.setRelease(workspaceId, release.id);

            // Down for the swap: stopped first so executions end and pools close.
            await this.stop(workspaceId, { emitNoEvents: true });

            // Its own state for the window: not stopped, coming back on its own.
            await this.workspaceRepository.setLifecycleState(Principal.SELF, workspaceId, 'updating');

            this.emit(workspaceId, createEvent('lifecycle:changed', { lifecycleState: 'updating' }));

            await this.provisioningService.rebuild(workspaceId, ownerId, planId);

            await this.start(workspaceId, { emitNoEvents: true });
        }
        catch (error) {
            this.emit(workspaceId, createEvent('update:failed', {
                releaseName: release.name,
                reason:      error instanceof Error ? error.message : String(error),
            }));

            // An update that died in its window must not stay 'updating' forever.
            const { lifecycleState } = await this.get(workspaceId);

            if (lifecycleState === 'updating') {
                await this.workspaceRepository.setLifecycleState(Principal.SELF, workspaceId, 'stopped');

                this.emit(workspaceId, createEvent('lifecycle:changed', { lifecycleState: 'stopped' }));
            }
            else
                this.emit(workspaceId, createEvent('lifecycle:changed', { lifecycleState }));

            throw error;
        }

        this.siloRouter.invalidate(workspaceId);

        this.emit(workspaceId, createEvent('lifecycle:changed', { lifecycleState: 'running' }));

        this.emit(workspaceId, createEvent('update:succeeded', { releaseId: release.id, releaseName: release.name }));
    }




    @Operation()
    public async setPlan(workspaceId: Workspace.Id, ownerId: User.Id, planId: Plan.Id): Promise<void> {
        await this.workspaceRepository.setPlan(Principal.SELF, workspaceId, planId);

        // Before the rebuild: what was bought is already true.
        this.emit(workspaceId, createEvent('plan:changed', { plan: this.planRegistry.get(planId) }));

        // A bigger plan takes effect now, not at the next re-check.
        this.entitlementService.unlock(workspaceId);

        // Down for the conversion, so executions end and pools close.
        await this.stop(workspaceId);

        try {
            await this.provisioningService.convert(workspaceId, ownerId, planId);
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




    @Operation(1)
    public async destroy(principal: Principal.User, workspaceId: Workspace.Id): Promise<void> {
        const { subdomain } = await this.get(workspaceId);

        await this.billingService.cancelSubscription(workspaceId);

        this.permissionService.invalidateCloudToken(workspaceId);

        await this.provisioningService.deprovision(workspaceId);

        await this.listingService.deleteAllForWorkspace(workspaceId);

        await this.workspaceRepository.delete(principal, workspaceId);

        // After the row goes, so the refill finds nothing.
        this.siloRouter.invalidate(workspaceId, [subdomain]);

        this.emit(workspaceId, createEvent('destroyed'));
    }
}
