import { ConflictException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { User } from '@pretzel-cloud/shared/domain';
import { Principal } from '@/auth/identity/principal';
import { IdentityAdminService } from '@/auth/identity/identity-admin.service';
import { WorkspaceService } from '@/services/Workspace/workspace.service';
import { UserRepository } from './user.repository';
import { WorkspaceRepository } from '@/services/Workspace/workspace.repository';
import { WorkspaceMemberService } from '@/services/Workspace/workspace-member.service';
import { AdminRepository } from '@/auth/admin.repository';
import { LockService } from '@/services/Locking/lock.service';
import { Operation } from '@/decorators/operation';

const USERNAME_TAKEN = 'users_username_lower_key';
const EMAIL_TAKEN    = 'users_email_lower_key';

const violates = (error: unknown, constraint: string) =>
    error instanceof Error && error.message.includes(constraint);

@Injectable()
export class UserService {

    private readonly logger = new Logger(UserService.name);

    constructor(
        private readonly identityAdminService: IdentityAdminService,
        private readonly userRepository: UserRepository,
        private readonly workspaceRepository: WorkspaceRepository,
        private readonly adminRepository: AdminRepository,
        @Inject(forwardRef(() => WorkspaceService))
        private readonly workspaceService: WorkspaceService,
        private readonly workspaceMemberService: WorkspaceMemberService,
        // Read by `@Operation`, which serialises an account's operations across instances.
        private readonly lockService: LockService,
    ) {}

    /** The id and email come from the verified token, never the body. */
    @Operation('account')
    public async register(principal: Principal.User, body: User.API.Register.Request): Promise<User> {
        const existing = await this.find(principal);

        if (existing)
            return existing;

        await this.identityAdminService.requireUser(principal.userId);

        try {
            await this.userRepository.insert(Principal.SELF, {
                id:          principal.userId,
                email:       principal.email,
                username:    body.username,
                displayName: body.displayName,
            });
        }
        catch (error) {
            if (violates(error, USERNAME_TAKEN))
                throw new ConflictException('That username is taken');

            // Same address, different subject: the issuer account was deleted and
            // remade. Merging them here would hand one person's workspaces to
            // whoever claimed the address next.
            if (violates(error, EMAIL_TAKEN))
                throw new ConflictException('That email belongs to a different account');

            throw error;
        }

        return this.get(principal);
    }

    async get(principal: Principal.User): Promise<User> {
        const row = await this.find(principal);

        if (!row)
            throw new NotFoundException('No profile yet');

        return row;
    }

    private async find(principal: Principal.User): Promise<User | null> {
        return this.userRepository.get(principal, principal.userId);
    }

    /** The names this deployment shows. The issuer holds no copy of them. */
    async update(principal: Principal.User, body: User.API.Update.Request): Promise<User> {
        const changes = {
            ...(body.username    !== undefined && { username:     body.username }),
            ...(body.displayName !== undefined && { display_name: body.displayName }),
        };

        if (Object.keys(changes).length === 0)
            return this.get(principal);

        try {
            const user = await this.userRepository.update(principal, changes);

            if (!user)
                throw new NotFoundException('No profile yet');

            return user;
        }
        catch (error) {
            if (violates(error, USERNAME_TAKEN))
                throw new ConflictException('That username is taken');

            throw error;
        }
    }

    /** Workspaces and memberships, then the credential and profile. A failure stops the rest. */
    @Operation('account', 1)
    public async delete(principal: Principal.User | Principal.Service, userId: User.Id): Promise<void> {
        const workspaces = await this.workspaceRepository.getByOwnerOrMember(principal, userId);

        for (const workspace of workspaces.filter((workspace) => workspace.ownerId === userId))
            await this.workspaceService.destroy(principal, workspace);

        for (const workspace of workspaces.filter((workspace) => workspace.ownerId !== userId))
            await this.workspaceMemberService.remove(workspace.id, userId);

        await this.identityAdminService.deleteUser(userId);

        try {
            await this.userRepository.delete(Principal.SELF, userId);
        }
        catch (error) {
            this.logger.error(`issuer account ${userId} is gone but its profile row is not`, error);

            throw error;
        }

        this.adminRepository.invalidate(userId);
    }
}
