import { BadRequestException, ForbiddenException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Admin, User } from '@pretzel-cloud/shared/domain';
import { Principal } from '@/auth/identity/principal';
import { Operation } from '@/decorators/operation';
import { LockService } from '@/services/Locking/lock.service';
import { WorkspaceAdminService } from '@/services/Workspace/workspace.admin.service';
import { UserRepository } from './user.repository';
import { UserAdminRepository } from './user.admin.repository';
import { UserService } from './user.service';

/** Account operations only an admin reaches, on accounts other than their own. */
@Injectable()
export class UserAdminService {

    private readonly logger = new Logger(UserAdminService.name);

    constructor(
        private readonly userService: UserService,
        private readonly userRepository: UserRepository,
        private readonly userAdminRepository: UserAdminRepository,
        @Inject(forwardRef(() => WorkspaceAdminService))
        private readonly workspaceAdminService: WorkspaceAdminService,
        // Read by `@Operation`, which serialises an account's operations across instances.
        private readonly lockService: LockService,
    ) {}

    public async list(adminUser: Principal.AdminUser): Promise<Admin.UserSummary[]> {
        return this.userAdminRepository.list(Principal.SELF);
    }

    @Operation('account', 1)
    public async delete(adminUser: Principal.AdminUser, userId: User.Id, confirmation: string): Promise<void> {
        if (adminUser.userId === userId)
            throw new ForbiddenException('Use account settings to delete your own account.');

        const user = await this.userRepository.get(Principal.SELF, userId);

        if (!user)
            throw new NotFoundException('User not found');

        if (confirmation.trim().toLowerCase() !== user.email.trim().toLowerCase())
            throw new BadRequestException('Type the user’s email address to confirm deletion.');

        this.logger.log(`Admin ${adminUser.userId} requested deletion of user ${userId}`);

        try {
            await this.userService.deleteUserData(userId, (workspace) =>
                this.workspaceAdminService.destroy(adminUser, workspace.id, workspace.display_name));

            this.logger.log(`Admin ${adminUser.userId} deleted user ${userId}`);
        }
        catch (error) {
            this.logger.error(`Admin ${adminUser.userId} could not delete user ${userId}`, error);

            throw error;
        }
    }
}
