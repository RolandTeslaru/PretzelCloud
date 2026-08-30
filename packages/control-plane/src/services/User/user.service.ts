import { ConflictException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { User, Workspace } from '@pretzel-cloud/shared/domain';
import { Principal } from '@/auth/identity/principal';
import { IdentityAdminService } from '@/auth/identity/identity-admin.service';
import { WorkspaceService } from '@/services/Workspace/workspace.service';
import { UserRepository } from './user.repository';

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
        @Inject(forwardRef(() => WorkspaceService))
        private readonly workspaceService: WorkspaceService,
    ) {}

    /** The id and email come from the verified token, never the body. */
    async register(principal: Principal.User, body: User.API.Register.Request): Promise<User> {
        const existing = await this.find(principal);

        if (existing)
            return existing;

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

    /** Workspaces, then the credential, then the profile. A failure stops the rest. */
    public async delete(principal: Principal.User): Promise<void> {
        const owned = await this.userRepository.getOwnedWorkspaceIds(principal);

        for (const row of owned)
            await this.workspaceService.destroy(principal, row.id as Workspace.Id);

        await this.identityAdminService.deleteUser(principal.userId);

        try {
            await this.userRepository.delete(Principal.SELF, principal.userId);
        }
        catch (error) {
            this.logger.error(`issuer account ${principal.userId} is gone but its profile row is not`, error);

            throw error;
        }
    }
}
