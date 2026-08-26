import { ConflictException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { User, Workspace } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';
import { Principal } from '@/auth/identity/principal';
import { IdentityAdminService } from '@/auth/identity/identity-admin.service';
import { WorkspaceService } from '@/services/Workspace/workspace.service';
import { UserDatabase } from './user.database';

const USERNAME_TAKEN = 'users_username_lower_key';
const EMAIL_TAKEN    = 'users_email_lower_key';

const violates = (error: unknown, constraint: string) =>
    error instanceof Error && error.message.includes(constraint);

@Injectable()
export class UserService {

    private readonly logger = new Logger(UserService.name);

    constructor(
        private readonly identityAdminService: IdentityAdminService,
        private readonly userDatabase: UserDatabase,
        @Inject(forwardRef(() => WorkspaceService))
        private readonly workspaceService: WorkspaceService,
    ) {}

    /** The id and email come from the verified token, never the body. */
    async register(principal: Principal.User, body: User.API.Register.Request): Promise<User> {
        const existing = await this.find(principal);

        if (existing)
            return existing;

        try {
            await PortalDB.asService('register user', (trx) => this.userDatabase.insert(trx, {
                id:          principal.userId,
                email:       principal.email,
                username:    body.username,
                displayName: body.displayName,
            }));
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
        return PortalDB.asUser(principal, (trx) => this.userDatabase.get(trx, principal.userId));
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
            const user = await PortalDB.asUser(principal, (trx) => this.userDatabase.update(trx, principal.userId, changes));

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
        const owned = await PortalDB.asUser(principal, (trx) => this.userDatabase.getOwnedWorkspaceIds(trx, principal.userId));

        for (const row of owned)
            await this.workspaceService.destroy(principal, Workspace.Id.parse(row.id));

        await this.identityAdminService.deleteUser(principal.userId);

        try {
            await PortalDB.asService('delete user', (trx) => this.userDatabase.delete(trx, principal.userId));
        }
        catch (error) {
            this.logger.error(`issuer account ${principal.userId} is gone but its profile row is not`, error);

            throw error;
        }
    }
}
