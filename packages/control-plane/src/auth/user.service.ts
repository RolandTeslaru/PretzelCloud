import { ConflictException, Injectable } from '@nestjs/common';
import { PortalDB } from '@/db/portal';
import { Principal } from './principal';

@Injectable()
export class UserService {

    /**
     * Mirrors an issuer subject into `users` on first sight. Service credential:
     * there is no insert policy for the app role, deliberately — a request
     * cannot conjure users other than its own caller.
     */
    async ensure(principal: Principal.User): Promise<void> {
        try {
            await PortalDB.asService('mirror issuer subject', (db) =>
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
    }
}
