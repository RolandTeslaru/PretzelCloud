import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { jwtVerify } from 'jose';
import { requireEnv } from '@/db/table';
import { Principal } from './principal';

/** Resolves the caller's identity from the request, or null. */
export abstract class IdentityResolver {
    abstract resolve(request: Request): Promise<Principal.User | null>;

    /**
     * The same answer, for callers holding a bare token. A socket handshake has
     * no Authorization header to read, so it carries its token in the query.
     */
    abstract resolveToken(token: string): Promise<Principal.User | null>;
}

const ALGORITHM = 'HS256';
const AUDIENCE  = 'authenticated';

let secret: Uint8Array | undefined;

function getSecret(): Uint8Array {
    return (secret ??= new TextEncoder().encode(requireEnv('AUTH_JWT_SECRET')));
}

/**
 * Verifies the issuer's token against the shared secret. No lookup and no call
 * to the issuer: a signature and three claims settle it.
 *
 * Identity only. What the caller may reach is decided per workspace, per
 * request, so nothing here reads a role.
 */
@Injectable()
export class TokenIdentityResolver extends IdentityResolver {

    async resolve(request: Request): Promise<Principal.User | null> {
        const [scheme, token] = request.headers.authorization?.split(' ') ?? [];

        if (scheme !== 'Bearer' || !token)
            return null;

        return this.resolveToken(token);
    }

    async resolveToken(token: string): Promise<Principal.User | null> {
        try {
            // Algorithm pinned: without it a token names its own, and `none`
            // would skip the signature entirely.
            const { payload } = await jwtVerify(token, getSecret(), {
                algorithms: [ALGORITHM],
                audience:   AUDIENCE,
            });

            const parsed = Principal.User.Schema.safeParse({
                type:   'user',
                userId: payload.sub,
                email:  payload.email,
            });

            return parsed.success ? parsed.data : null;
        }
        catch {
            // Forged, expired, or meant for someone else — all the same answer.
            return null;
        }
    }
}
