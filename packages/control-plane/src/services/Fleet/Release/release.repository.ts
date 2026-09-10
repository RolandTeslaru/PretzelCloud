import { Injectable } from '@nestjs/common';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { FleetDB } from '@/db/fleet';
import { Repository, Transactional } from '@/db/repository';
import { Principal } from '@/auth/identity/principal';

/** Row operations on `releases`. */
@Injectable()
export class ReleaseRepository extends Repository(FleetDB) {

    @Transactional('service')
    public async getLatest(principal: Principal.Service) {
        const row = await this.trx
            .selectFrom('releases')
            .selectAll()
            .orderBy('created_at', 'desc')
            .limit(1)
            .executeTakeFirst();

        return row ? FleetDB.Release.Row.parse(row) : undefined;
    }




    @Transactional('service')
    public async getById(principal: Principal.Service, releaseId: Fleet.Release.Id) {
        const row = await this.trx
            .selectFrom('releases')
            .selectAll()
            .where('id', '=', releaseId)
            .executeTakeFirstOrThrow();

        return FleetDB.Release.Row.parse(row);
    }




    /** Null when the name is taken: a re-announced build, not a new release. */
    @Transactional('service')
    public async create(
        principal:   Principal.Service,
        name:        Fleet.Release.Name,
        description: string | null,
        images:      { imageCombined: string; imageBackend: string; imageWorker: string },
    ) {
        const row = await this.trx
            .insertInto('releases')
            .values({
                name,
                description,
                image_combined: images.imageCombined,
                image_backend:  images.imageBackend,
                image_worker:   images.imageWorker,
            })
            .onConflict((oc) => oc.column('name').doNothing())
            .returningAll()
            .executeTakeFirst();

        return row ? FleetDB.Release.Row.parse(row) : null;
    }
}
