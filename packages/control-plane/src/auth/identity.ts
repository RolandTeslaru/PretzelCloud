import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { Principal } from './principal';

/** Resolves the caller's identity from the request, or null. */
export abstract class IdentityResolver {
    abstract resolve(request: Request): Promise<Principal.User | null>;
}

/**
 * Reads the identity straight off two headers and believes them. Anyone who can
 * reach the port can be anyone.
 *
 * Requires PORTAL_DEV_AUTH=true, and refuses to construct without it, so it
 * cannot be left on by accident. Replaced by token verification.
 */
@Injectable()
export class DevIdentityResolver extends IdentityResolver {

    private readonly logger = new Logger(DevIdentityResolver.name);

    static readonly USER_HEADER  = 'x-dev-user-id';
    static readonly EMAIL_HEADER = 'x-dev-user-email';

    constructor() {
        super();

        if (process.env.PORTAL_DEV_AUTH !== 'true')
            throw new Error('DevIdentityResolver requires PORTAL_DEV_AUTH=true');

        this.logger.warn('Header-trusting identity is active. Every request is whoever it claims to be.');
    }

    async resolve(request: Request): Promise<Principal.User | null> {
        const parsed = Principal.User.Schema.safeParse({
            type:   'user',
            userId: request.header(DevIdentityResolver.USER_HEADER),
            email:  request.header(DevIdentityResolver.EMAIL_HEADER),
        });

        return parsed.success ? parsed.data : null;
    }
}
