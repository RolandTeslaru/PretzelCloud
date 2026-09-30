import { Controller, Get, NotFoundException } from '@nestjs/common';
import { Fleet } from '@pretzel-cloud/shared/domain';
import { ReleaseService } from './release.service';

// Open to anyone: self-hosted installations ask it whether a newer version exists.
@Controller('releases')
export class ReleaseController {

    constructor(private readonly releaseService: ReleaseService) {}

    /** What the portal compares every workspace against, and self-hosted installations compare themselves against. */
    @Get('latest')
    public async latest(): Promise<Fleet.Release.API.Latest.Response> {
        const release = await this.releaseService.getLatest();

        if (!release)
            throw new NotFoundException('No release has been announced yet');

        return { id: release.id, name: release.name, description: release.description };
    }
}
