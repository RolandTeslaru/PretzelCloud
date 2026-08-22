import { Controller, ForbiddenException, Get, HttpCode, NotFoundException, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { PortalDB } from '@/db/portal';
import { Principal } from '@/auth/principal';
import { AuthenticatedUser } from '@/auth/principal.decorator';
import { UserAuthGuard } from '@/auth/user-auth.guard';
import { Router } from '@/services/WorkspaceRouter/router.service';
import { WorkspaceTokenIssuer } from './token-issuer.service';

/**
 * Exchanges a session for a token scoped to one workspace.
 *
 * Which workspace is read from the Host header — the same resolution the proxy
 * uses, so the editor never has to know its own id. The Host is not the gate:
 * anyone can name any hostname, and the access index decides.
 */
@Controller('session')
export class WorkspaceSessionController {

    constructor(
        private readonly tokenIssuer: WorkspaceTokenIssuer,
        private readonly router: Router,
    ) {}

    @Post('token')
    @UseGuards(UserAuthGuard)
    @HttpCode(200)
    async mint(@AuthenticatedUser() principal: Principal.User, @Req() req: Request) {
        const resolution = await this.router.resolve(req);

        if (!resolution)
            throw new NotFoundException('No such workspace');

        const member = await PortalDB.asService('check access for token mint', (db) =>
            db
                .selectFrom('workspace_members')
                .select('user_id')
                .where('workspace_id', '=', resolution.workspaceId)
                .where('user_id', '=', principal.userId)
                .executeTakeFirst(),
        );

        if (!member)
            throw new ForbiddenException('Not a member of this workspace');

        return this.tokenIssuer.mint(principal, resolution.workspaceId);
    }
}

/**
 * The public key, at the conventional address. Silos receive theirs through
 * the machine env and never fetch this; it exists for everything that is not
 * a silo.
 */
@Controller('.well-known')
export class JwksController {

    constructor(private readonly tokenIssuer: WorkspaceTokenIssuer) {}

    @Get('jwks.json')
    async jwks() {
        return { keys: [await this.tokenIssuer.publicJwk()] };
    }
}
