import { Injectable } from '@nestjs/common';
import { User } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';
import { AllowedDatabaseRoles, DatabaseClass } from '@/decorators/database';

type UserTrx    = PortalDB.UserTransaction;
type ServiceTrx = PortalDB.ServiceTransaction;
type AnyTrx     = UserTrx | ServiceTrx;

@Injectable()
@DatabaseClass
export class UserDatabase {

    @AllowedDatabaseRoles('service')
    public async insert(trx: ServiceTrx, values: {
        id:          User.Id;
        email:       string;
        username:    string;
        displayName: string;
    }): Promise<void> {
        await trx
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

    @AllowedDatabaseRoles('user', 'service')
    public async get(trx: AnyTrx, userId: User.Id): Promise<User | null> {
        const row = await trx
            .selectFrom('users')
            .selectAll()
            .where('id', '=', userId)
            .executeTakeFirst();

        return row ? PortalDB.User.toDomain(PortalDB.User.Row.parse(row)) : null;
    }

    @AllowedDatabaseRoles('user')
    public async update(trx: UserTrx, userId: User.Id, changes: {
        username?:     string;
        display_name?: string;
    }): Promise<User | null> {
        const row = await trx
            .updateTable('users')
            .set(changes)
            .where('id', '=', userId)
            .returningAll()
            .executeTakeFirst();

        return row ? PortalDB.User.toDomain(PortalDB.User.Row.parse(row)) : null;
    }

    @AllowedDatabaseRoles('service')
    public async delete(trx: ServiceTrx, userId: User.Id): Promise<void> {
        await trx
            .deleteFrom('users')
            .where('id', '=', userId)
            .execute();
    }

    @AllowedDatabaseRoles('user')
    public async getOwnedWorkspaceIds(trx: UserTrx, userId: User.Id) {
        return trx
            .selectFrom('workspaces')
            .select('id')
            .where('owner_id', '=', userId)
            .execute();
    }
}
