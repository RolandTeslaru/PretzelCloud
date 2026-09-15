import { Injectable } from '@nestjs/common';
import { Admin, User } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';
import { Repository, Transactional } from '@/db/repository';
import { Principal } from '@/auth/identity/principal';

/** Row operations on `users` that reach every account. */
@Injectable()
export class UserAdminRepository extends Repository(PortalDB) {

    @Transactional('service')
    public async list(principal: Principal.Service): Promise<Admin.UserSummary[]> {
        const rows = await this.trx
            .selectFrom('users')
            .selectAll('users')
            .select((eb) => eb.selectFrom('workspaces')
                .select((count) => count.fn.countAll<string>().as('count'))
                .whereRef('workspaces.owner_id', '=', 'users.id')
                .as('owned_workspace_count'))
            .orderBy('users.created_at', 'desc')
            .execute();

        return rows.map((row) => ({
            ...PortalDB.User.toDomain(PortalDB.User.Row.parse(row)),
            ownedWorkspaceCount: Number(row.owned_workspace_count),
        }));
    }

    @Transactional('service')
    public async getByIds(principal: Principal.Service, userIds: User.Id[]): Promise<User[]> {
        if (userIds.length === 0)
            return [];

        const rows = await this.trx
            .selectFrom('users')
            .selectAll()
            .where('id', 'in', userIds)
            .execute();

        return rows.map((row) => PortalDB.User.toDomain(PortalDB.User.Row.parse(row)));
    }
}
