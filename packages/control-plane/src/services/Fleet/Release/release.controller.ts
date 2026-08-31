import { Controller, Get, NotFoundException, UseGuards } from '@nestjs/common';
import { Fleet } from '@pretzel-cloud/shared/domain';
import { UserAuthGuard } from '@/auth/guards/user-auth.guard';
import { ReleaseService } from './release.service';

@Controller('releases')
@UseGuards(UserAuthGuard)
export class ReleaseController {

    constructor(private readonly releaseService: ReleaseService) {}

    /** What the portal compares every workspace against. */
    @Get('latest')
    async latest(): Promise<Fleet.Release.API.Latest.Response> {
        const release = await this.releaseService.getLatest();

        if (!release)
            throw new NotFoundException('No release has been announced yet');

        return { id: release.id, name: release.name };
    }
}
