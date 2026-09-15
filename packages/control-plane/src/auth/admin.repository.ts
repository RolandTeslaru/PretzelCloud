import { Injectable } from '@nestjs/common';
import { User } from '@pretzel-cloud/shared/domain';
import { PortalDB } from '@/db/portal';
import { Repository, Transactional } from '@/db/repository';
import { GlobalCaching, GlobalCachingService } from '@/services/Caching/caching.service';
import { Principal } from './identity/principal';

const CHANNEL = GlobalCaching.Channel.parse('cache:admin-flags');

// A grant or revoke made in SQL reaches every instance within this window.
const TTL_MS = 60_000;

const MAX_ENTRIES = 10_000;

/** Reads `users.is_admin`, which only the service role can write. */
@Injectable()
export class AdminRepository extends Repository(PortalDB) {

    constructor(private readonly globalCachingService: GlobalCachingService) {
        super();

        this.globalCachingService.create(CHANNEL, TTL_MS, MAX_ENTRIES);
    }

    public async isAdmin(principal: Principal.Service, userId: User.Id): Promise<boolean> {
        const cached = this.globalCachingService.get(CHANNEL, userId) as boolean | undefined;

        if (cached !== undefined)
            return cached;

        const isAdmin = await this.readIsAdmin(principal, userId);

        this.globalCachingService.set(CHANNEL, userId, isAdmin);

        return isAdmin;
    }

    public invalidate(userId: User.Id): void {
        this.globalCachingService.delete(CHANNEL, userId);
    }

    @Transactional('service')
    private async readIsAdmin(principal: Principal.Service, userId: User.Id): Promise<boolean> {
        const row = await this.trx
            .selectFrom('users')
            .select('is_admin')
            .where('id', '=', userId)
            .executeTakeFirst();

        return row?.is_admin ?? false;
    }
}
