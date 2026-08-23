import { ConflictException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { User, Workspace } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';
import { Principal } from '@/auth/principal';
import { IdentityAdminService } from '@/auth/identity-admin.service';
import { WorkspaceService } from '@/services/Workspace/workspace.service';

const USERNAME_TAKEN = 'users_username_lower_key';
const EMAIL_TAKEN    = 'users_email_lower_key';

const violates = (error: unknown, constraint: string) =>
    error instanceof Error && error.message.includes(constraint);

@Injectable()
export class UserService {

    private readonly logger = new Logger(UserService.name);

    constructor(
        private readonly identities: IdentityAdminService,
        @Inject(forwardRef(() => WorkspaceService))
        private readonly workspaces: WorkspaceService,
    ) {}

    /**
     * Creates the profile row for the caller, or returns the existing one.
     *
     * Service credential: there is no insert policy for the app role,
     * deliberately — a request cannot conjure users other than its own caller.
     * The id and email come from the verified token, never the body.
     */
    async register(principal: Principal.User, body: User.API.Register.Request): Promise<User> {
        const existing = await this.find(principal);

        if (existing)
            return existing;

        try {
            await PortalDB.asService('register user', (db) =>
                db
                    .insertInto('users')
                    .values({
                        id:           principal.userId,
                        email:        principal.email,
                        username:     body.username,
                        display_name: body.displayName,
                        avatar_url:   null,
                    })
                    .execute(),
            );
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
        const row = await PortalDB.asUser(principal, (trx) =>
            trx
                .selectFrom('users')
                .selectAll()
                .where('id', '=', principal.userId)
                .executeTakeFirst(),
        );

        return row ? PortalDB.User.toDomain(PortalDB.User.Row.parse(row)) : null;
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
            const row = await PortalDB.asUser(principal, (trx) =>
                trx
                    .updateTable('users')
                    .set(changes)
                    .where('id', '=', principal.userId)
                    .returningAll()
                    .executeTakeFirst(),
            );

            if (!row)
                throw new NotFoundException('No profile yet');

            return PortalDB.User.toDomain(PortalDB.User.Row.parse(row));
        }
        catch (error) {
            if (violates(error, USERNAME_TAKEN))
                throw new ConflictException('That username is taken');

            throw error;
        }
    }

    /**
     * Closes the account: the workspaces it owns, then the credential at the
     * issuer, then the profile here.
     *
     * Each workspace goes through the ordinary destroy, so its subscription is
     * cancelled and its machines are torn down rather than orphaned. One at a
     * time and in order — a failure stops the rest, leaving an account that can
     * still sign in to see what is left.
     *
     * The issuer goes before the profile. If that last delete fails, what is
     * left cannot sign in; the other order leaves a credential whose next
     * sign-in would build the profile again.
     */
    public async delete(principal: Principal.User): Promise<void> {
        const owned = await PortalDB.asUser(principal, (trx) =>
            trx
                .selectFrom('workspaces')
                .select('id')
                .where('owner_id', '=', principal.userId)
                .execute(),
        );

        for (const row of owned)
            await this.workspaces.destroy(principal, Workspace.Id.parse(row.id));

        await this.identities.deleteUser(principal.userId);

        try {
            await PortalDB.asService('delete user', (db) =>
                db
                    .deleteFrom('users')
                    .where('id', '=', principal.userId)
                    .execute(),
            );
        }
        catch (error) {
            this.logger.error(`issuer account ${principal.userId} is gone but its profile row is not`, error);

            throw error;
        }
    }
}
