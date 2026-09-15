import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Admin, Workspace } from '@pretzel-cloud/shared/domain';
import { Principal } from '@/auth/identity/principal';
import { Operation } from '@/decorators/operation';
import { LockService } from '@/services/Locking/lock.service';
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

    @Operation('workspace', 1)
    public async destroy(adminUser: Principal.AdminUser, workspaceId: Workspace.Id, confirmation: string): Promise<void> {
        const workspace = await this.workspaceService.get(workspaceId);

        if (confirmation.trim() !== workspace.displayName.trim())
            throw new BadRequestException('Type the workspace name exactly to confirm deletion.');

        this.logger.log(`Admin ${adminUser.userId} requested deletion of workspace ${workspaceId} owned by ${workspace.ownerId}`);

        try {
            await this.workspaceService.destroyWorkspace(workspace, () => this.workspaceAdminRepository.delete(Principal.SELF, workspaceId));

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
}
