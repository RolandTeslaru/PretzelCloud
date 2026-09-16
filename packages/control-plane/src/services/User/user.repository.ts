import { Injectable } from '@nestjs/common';
import { User } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';
import { Repository, Transactional } from '@/db/repository';
import { Principal } from '@/auth/identity/principal';

/** Row operations on `users`. */
@Injectable()
export class UserRepository extends Repository(PortalDB) {

    @Transactional('service')
    public async insert(principal: Principal.Service, values: {
        id:          User.Id;
        email:       string;
        username:    string;
        displayName: string;
    }): Promise<void> {
        await this.trx
            .insertInto('users')
            .values({
                id:           values.id,
                email:        values.email,
                username:     values.username,
                display_name: values.displayName,
                avatar_url:   null,
            })
            .execute();
    }

    @Transactional('user', 'service')
    public async get(principal: Principal.User | Principal.Service, userId: User.Id): Promise<User | null> {
        const row = await this.trx
            .selectFrom('users')
            .selectAll()
            .where('id', '=', userId)
            .executeTakeFirst();

        return row ? PortalDB.User.toDomain(PortalDB.User.Row.parse(row)) : null;
    }

    @Transactional('user')
    public async update(principal: Principal.User, changes: {
        username?:     string;
        display_name?: string;
    }): Promise<User | null> {
        const row = await this.trx
            .updateTable('users')
            .set(changes)
            .where('id', '=', principal.userId)
            .returningAll()
            .executeTakeFirst();

        return row ? PortalDB.User.toDomain(PortalDB.User.Row.parse(row)) : null;
    }

    @Transactional('service')
    public async delete(principal: Principal.Service, userId: User.Id): Promise<void> {
        await this.trx
            .deleteFrom('users')
            .where('id', '=', userId)
            .execute();
    }
}
