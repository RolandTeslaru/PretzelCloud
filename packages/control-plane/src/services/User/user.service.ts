import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { User } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';
import { Principal } from '@/auth/principal';

@Injectable()
export class UserService {

    /**
     * Creates the profile row for the caller, or returns the existing one.
     *
     * Service credential: there is no insert policy for the app role,
     * deliberately — a request cannot conjure users other than its own caller.
     * Everything written here comes from the verified token, never the body.
     */
    async register(principal: Principal.User): Promise<User> {
        try {
            await PortalDB.asService('register user', (db) =>
                db
                    .insertInto('users')
                    .values({
                        id:           principal.userId,
                        email:        principal.email,
                        display_name: principal.email.split('@')[0] ?? principal.email,
                        avatar_url:   null,
                    })
                    .onConflict((oc) => oc.column('id').doNothing())
                    .execute(),
            );
        }
        catch (error) {
            // Same address, different subject: the issuer account was deleted and
            // remade. Merging them here would hand one person's workspaces to
            // whoever claimed the address next.
            if (error instanceof Error && error.message.includes('users_email_lower_key'))
                throw new ConflictException('That email belongs to a different account');

            throw error;
        }

        return this.get(principal);
    }

    async get(principal: Principal.User): Promise<User> {
        const row = await PortalDB.asUser(principal, (trx) =>
            trx
                .selectFrom('users')
                .selectAll()
                .where('id', '=', principal.userId)
                .executeTakeFirst(),
        );

        if (!row)
            throw new NotFoundException('No profile yet');

        return PortalDB.User.toDomain(PortalDB.User.Row.parse(row));
    }

    /** The name this deployment shows. The issuer holds no copy of it. */
    async setDisplayName(principal: Principal.User, displayName: string): Promise<User> {
        const row = await PortalDB.asUser(principal, (trx) =>
            trx
                .updateTable('users')
                .set({ display_name: displayName })
                .where('id', '=', principal.userId)
                .returningAll()
                .executeTakeFirst(),
        );

        if (!row)
            throw new NotFoundException('No profile yet');

        return PortalDB.User.toDomain(PortalDB.User.Row.parse(row));
    }
}
