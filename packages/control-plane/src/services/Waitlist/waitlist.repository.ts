import { Injectable } from '@nestjs/common';
import { Waitlist } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';
import { Repository, Transactional } from '@/db/repository';
import { Principal } from '@/auth/identity/principal';

/** Row operations on `waitlist`. */
@Injectable()
export class WaitlistRepository extends Repository(PortalDB) {

    // False when the address was already on the list; a second join changes nothing.
    @Transactional('service')
    public async add(principal: Principal.Service, email: Waitlist.Email): Promise<boolean> {
        const inserted = await this.trx
            .insertInto('waitlist')
            .values({ email })
            .onConflict((conflict) => conflict
                .column('email')
                .doNothing())
            .returning('email')
            .executeTakeFirst();

        return inserted !== undefined;
    }

    @Transactional('service')
    public async markThankYouSent(principal: Principal.Service, email: Waitlist.Email): Promise<void> {
        await this.trx
            .updateTable('waitlist')
            .set({ thank_you_sent_at: new Date() })
            .where('email', '=', email)
            .execute();
    }

    // Oldest first, so a backlog drains in the order people joined.
    @Transactional('service')
    public async getUnthanked(principal: Principal.Service, joinedBefore: Date, limit: number): Promise<Waitlist.Email[]> {
        const rows = await this.trx
            .selectFrom('waitlist')
            .select('email')
            .where('thank_you_sent_at', 'is', null)
            .where('created_at', '<', joinedBefore)
            .orderBy('created_at')
            .limit(limit)
            .execute();

        return rows.map((row) => Waitlist.Email.parse(row.email));
    }
}
