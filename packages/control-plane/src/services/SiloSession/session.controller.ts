import { Controller, ForbiddenException, Get, HttpCode, NotFoundException, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { PortalDB } from '@/db/portal';
import { Principal } from '@/auth/identity/principal';
import { AuthenticatedUser } from '@/auth/identity/principal.decorator';
import { UserAuthGuard } from '@/auth/guards/user-auth.guard';
import { Router } from '@/services/SiloRouter/router.service';
import { SiloTokenIssuer } from './token-issuer.service';

/**
 * Exchanges a session for a token scoped to one workspace.
 *
 * Which workspace is read from the Host header — the same siloTicket the proxy
 * uses, so the editor never has to know its own id. The Host is not the gate:
 * anyone can name any hostname, and the access index decides.
 */
@Controller('session')
export class SiloSessionController {

    constructor(
        private readonly siloTokenIssuer: SiloTokenIssuer,
        private readonly router: Router,
    ) {}

    @Post('token')
    @UseGuards(UserAuthGuard)
    @HttpCode(200)
    async mint(@AuthenticatedUser() principal: Principal.User, @Req() req: Request) {
        const siloTicket = await this.router.getTicket(req);

        if (!siloTicket)
            throw new NotFoundException('No such workspace');

        const member = await PortalDB.asService('check access for token mint', (db) =>
            db
                .selectFrom('workspace_members')
                .select('user_id')
                .where('workspace_id', '=', siloTicket.workspaceId)
                .where('user_id', '=', principal.userId)
                .executeTakeFirst(),
        );

        if (!member)
            throw new ForbiddenException('Not a member of this workspace');

        return this.siloTokenIssuer.mint(principal, siloTicket.workspaceId);
    }
}

/**
 * The public key, at the conventional address. Silos receive theirs through
 * the machine env and never fetch this; it exists for everything that is not
 * a silo.
 */
@Controller('.well-known')
export class JwksController {

    constructor(private readonly siloTokenIssuer: SiloTokenIssuer) {}

    @Get('jwks.json')
    async jwks() {
        return { keys: [await this.siloTokenIssuer.publicJwk()] };
    }
}
