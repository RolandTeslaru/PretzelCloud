import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Admin, Plan, Workspace } from '@pretzel-cloud/shared/domain';
import { Principal } from '@/auth/identity/principal';
import { Operation } from '@/decorators/operation';
import { LockService } from '@/services/Locking/lock.service';
import { EntitlementService } from '@/services/Entitlement/entitlement.service';
import { PlanRegistry } from '@/services/Plan/plan.registry';
import { HardwareService } from '@/services/Fleet/Hardware/hardware.service';
import { HardwareStatisticsService } from '@/services/Fleet/Hardware/statistics.service';
import { UserAdminRepository } from '@/services/User/user.admin.repository';
import { WorkspaceAdminRepository } from './workspace.admin.repository';
import { WorkspaceService } from './workspace.service';

/** Workspace operations only an admin reaches, across every owner. */
@Injectable()
export class WorkspaceAdminService {

    private readonly logger = new Logger(WorkspaceAdminService.name);

    constructor(
        private readonly workspaceService:         WorkspaceService,
        private readonly workspaceAdminRepository: WorkspaceAdminRepository,
        private readonly userAdminRepository:      UserAdminRepository,
        private readonly hardware:                 HardwareService,
        private readonly hardwareStatistics:       HardwareStatisticsService,
        private readonly entitlement:              EntitlementService,
        private readonly planRegistry:              PlanRegistry,
        // Read by `@Operation`, which serialises a workspace's operations across instances.
        private readonly lockService:              LockService,
    ) {}

    public async list(adminUser: Principal.AdminUser): Promise<Admin.WorkspaceSummary[]> {
        const workspaces = await this.workspaceAdminRepository.list(Principal.SELF);

        const ownerIds = [...new Set(workspaces.map((workspace) => workspace.ownerId))];

        const owners = await this.userAdminRepository.getByIds(Principal.SELF, ownerIds);

        const ownersById = new Map(owners.map((owner) => [owner.id, owner]));

        // An owner missing here was deleted after the first read, and their workspace with them.
        return workspaces.flatMap((workspace) => {
            const owner = ownersById.get(workspace.ownerId);

            return owner ? [{ workspace, owner }] : [];
        });
    }

    /** One workspace with its fleet facts, the people on it, and what it has used. */
    public async get(adminUser: Principal.AdminUser, workspaceId: Workspace.Id): Promise<Admin.WorkspaceDetail> {
        const workspace = await this.workspaceService.get(workspaceId);

        const memberIds = await this.workspaceAdminRepository.getMemberIds(Principal.SELF, workspaceId);

        const users = await this.userAdminRepository.getByIds(Principal.SELF, [...new Set([workspace.ownerId, ...memberIds])]);

        const owner = users.find((user) => user.id === workspace.ownerId);

        if (!owner)
            throw new NotFoundException('This workspace has no owner on record');

        const [hardwareFieldsByWorkspaceId, usage, hardwareStatistics] = await Promise.all([
            this.hardware.getHardwareFieldsForWorkspaces([workspaceId]),
            this.entitlement.getPeriodUsageReport(workspaceId),
            this.hardwareStatistics.get(workspaceId),
        ]);

        const hardwareFields = hardwareFieldsByWorkspaceId.get(workspaceId);

        return {
            workspace: {
                ...workspace,
                region:      hardwareFields?.region ?? null,
                releaseId:   hardwareFields?.releaseId ?? null,
                releaseName: hardwareFields?.releaseName ?? null,
                driver:      hardwareFields?.driver ?? null,
            },
            owner,
            members: users.filter((user) => memberIds.includes(user.id)),
            usage,
            hardwareStatistics,
        };
    }

    public async listUsage(adminUser: Principal.AdminUser, workspaceId: Workspace.Id, window: Workspace.Usage.Window): Promise<Workspace.Usage[]> {
        await this.workspaceService.get(workspaceId);

        return this.entitlement.executions.get(workspaceId, Workspace.Usage.getPeriodFromWindow(window));
    }

    public async getUsageSeries(adminUser: Principal.AdminUser, workspaceId: Workspace.Id): Promise<Workspace.Usage.Point[]> {
        await this.workspaceService.get(workspaceId);

        const period = await this.entitlement.getBillingPeriod(workspaceId);

        const points = await this.entitlement.executions.getDailyCounts(workspaceId, period);

        return Workspace.Usage.getDailySeries(period, points);
    }

    public async getUsageReport(adminUser: Principal.AdminUser, workspaceId: Workspace.Id): Promise<Workspace.Usage.Report> {
        await this.workspaceService.get(workspaceId);

        return this.entitlement.getPeriodUsageReport(workspaceId);
    }

    public async assertLifecycleAllowed(adminUser: Principal.AdminUser, workspaceId: Workspace.Id): Promise<void> {
        const workspace = await this.workspaceService.get(workspaceId);

        if (workspace.lifecycleState === 'disabled')
            throw new BadRequestException('Enable this workspace before changing its lifecycle.');
    }

    @Operation('workspace', 1)
    public async lifecycle(adminUser: Principal.AdminUser, workspaceId: Workspace.Id, action: Workspace.Lifecycle.Action): Promise<void> {
        this.logger.log(`Admin ${adminUser.userId} requested ${action} for workspace ${workspaceId}`);

        await this.workspaceService.runTransition(workspaceId, action);
    }

    @Operation('workspace', 1)
    public async destroy(adminUser: Principal.AdminUser, workspaceId: Workspace.Id, confirmation: string): Promise<void> {
        const workspace = await this.workspaceService.get(workspaceId);

        if (confirmation.trim() !== workspace.displayName.trim())
            throw new BadRequestException('Type the workspace name exactly to confirm deletion.');

        this.logger.log(`Admin ${adminUser.userId} requested deletion of workspace ${workspaceId} owned by ${workspace.ownerId}`);

        try {
            await this.workspaceService.destroy(Principal.SELF, workspace);

            this.logger.log(`Admin ${adminUser.userId} deleted workspace ${workspaceId}`);
        }
        catch (error) {
            this.logger.error(`Admin ${adminUser.userId} could not delete workspace ${workspaceId}`, error);

            throw error;
        }
    }

    public async disable(adminUser: Principal.AdminUser, workspaceId: Workspace.Id, reason: string): Promise<void> {
        await this.workspaceService.disable(workspaceId, reason);
    }

    public async enable(adminUser: Principal.AdminUser, workspaceId: Workspace.Id): Promise<void> {
        await this.workspaceService.enable(workspaceId);
    }

    public async assertPlanChangeAllowed(adminUser: Principal.AdminUser, workspaceId: Workspace.Id, planId: Plan.Id): Promise<Workspace> {
        const workspace = await this.workspaceService.get(workspaceId);

        if (workspace.lifecycleState === 'disabled')
            throw new BadRequestException('Enable this workspace before changing its plan.');

        if (workspace.subscriptionStatus !== null && !['canceled', 'incomplete_expired'].includes(workspace.subscriptionStatus))
            throw new BadRequestException('Stripe still controls this workspace plan.');

        if (!this.planRegistry.find(planId))
            throw new NotFoundException(`No such plan: ${planId}`);

        if (workspace.plan.id === planId)
            throw new BadRequestException('This workspace is already on that plan.');

        return workspace;
    }

    public async setPlan(adminUser: Principal.AdminUser, workspace: Workspace, planId: Plan.Id): Promise<void> {
        this.logger.log(`Admin ${adminUser.userId} assigned plan ${planId} to workspace ${workspace.id}`);

        await this.workspaceService.setPlan(workspace.id, workspace.ownerId, planId);
    }
}
