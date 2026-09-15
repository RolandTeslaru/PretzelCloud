import { Controller, Post, UseGuards } from '@nestjs/common';
import { Fleet } from '@pretzel-cloud/shared/domain';
import { UserAuthGuard } from '@/auth/guards/user-auth.guard';
import { AdminGuard } from '@/auth/guards/admin.guard';
import { ZodBody } from '@pretzel-cloud/shared/server/pipes/zod.pipe';
import { ReleaseService } from '@/services/Fleet/Release/release.service';

/** Release announcements from the release pipeline. */
@Controller('admin')
@UseGuards(UserAuthGuard, AdminGuard)
export class AdminController {
    constructor(private readonly releaseService: ReleaseService) {}

    @Post('releases')
    public async createRelease(
        @ZodBody(Fleet.Release.API.Create.Request) body: Fleet.Release.API.Create.Request,
    ): Promise<Fleet.Release.API.Create.Response> {
        return { release: await this.releaseService.create(body.name, body.description ?? null, body) };
    }
}
