import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { FleetDB } from '@/db/fleet';
import { Principal } from '@/auth/identity/principal';
import { ReleaseRepository } from './release.repository';

/** The catalogue of shipped versions, and which one each workspace runs. */
@Injectable()
export class ReleaseService {

    private readonly logger = new Logger(ReleaseService.name);

    constructor(private readonly releaseRepository: ReleaseRepository) {}




    /** The newest release: what provisioning pins and update moves to. */
    public async getLatest(): Promise<Fleet.Release | null> {
        const row = await this.releaseRepository.getLatest(Principal.SELF);

        return row ? FleetDB.Release.toDomain(row) : null;
    }




    public async getById(releaseId: Fleet.Release.Id): Promise<Fleet.Release> {
        return FleetDB.Release.toDomain(await this.releaseRepository.getById(Principal.SELF, releaseId));
    }




    /** One name, one release, forever — announcing a taken name is refused. */
    public async create(
        name:        Fleet.Release.Name,
        description: string | null,
        images:      { imageCombined: string; imageBackend: string; imageWorker: string },
    ): Promise<Fleet.Release> {
        // Blank and absent are the same thing: one release with no changelog.
        const changelog = description?.trim() || null;

        const row = await this.releaseRepository.create(Principal.SELF, name, changelog, images);

        if (!row)
            throw new ConflictException(`A release named ${name} already exists`);

        this.logger.log(`Release ${name} recorded`);

        return FleetDB.Release.toDomain(row);
    }




    /** Per workspace, the id and name of the release its machines are built from. */
    public async getInfoForWorkspaces(workspaceIds: Workspace.Id[]): Promise<Map<Workspace.Id, { id: Fleet.Release.Id; name: Fleet.Release.Name }>> {
        const rows = await this.releaseRepository.getByWorkspaceIds(Principal.SELF, workspaceIds);

        return new Map(rows.map((row) => [row.workspaceId, { id: row.releaseId, name: row.releaseName }]));
    }
}
