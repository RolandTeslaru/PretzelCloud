import { Injectable } from '@nestjs/common';
import { SignJWT, importJWK, type JWK } from 'jose';
import { Workspace } from '@pretzel-cloud/shared/domain';
import { Principal } from '@/auth/identity/principal';
import { requireEnv } from '@/db/table';

/** Short on purpose: expiry is the only revocation these tokens have. */
const TTL_SECONDS = 15 * 60;

type SigningKey = {
    key: Awaited<ReturnType<typeof importJWK>>;
    kid: string;
    publicJwk: JWK;
};

/**
 * Signs workspace-scoped tokens with a key only this process holds. Silos get
 * the public half and can verify but never mint — which is the entire point:
 * the fleet-wide minting capability lives here and at the issuer, nowhere else.
 */
@Injectable()
export class WorkspaceTokenIssuer {

    private loaded?: Promise<SigningKey>;

    private load(): Promise<SigningKey> {
        return (this.loaded ??= (async () => {
            const jwk = JSON.parse(requireEnv('WORKSPACE_TOKEN_PRIVATE_JWK')) as JWK;

            if (!jwk.kid)
                throw new Error('WORKSPACE_TOKEN_PRIVATE_JWK has no kid — regenerate with scripts/token-key.ts');

            const key = await importJWK(jwk, 'ES256');

            // The public half is the private JWK minus its secret scalar.
            const { d: _d, ...publicJwk } = jwk;

            return { key, kid: jwk.kid, publicJwk };
        })());
    }

    issuer(): string {
        return requireEnv('TOKEN_ISSUER');
    }

    /** What silos verify against, and what the JWKS endpoint publishes. */
    async publicJwk(): Promise<JWK> {
        return (await this.load()).publicJwk;
    }

    /** Takes a principal, not an id: only a verified caller can be minted for. */
    async mint(principal: Principal.User, workspaceId: Workspace.Id): Promise<{ token: string; expiresAt: number }> {
        const { key, kid } = await this.load();

        const expiresAt = Math.floor(Date.now() / 1000) + TTL_SECONDS;

        const token = await new SignJWT({})
            .setProtectedHeader({ alg: 'ES256', kid })
            .setSubject(principal.userId)
            .setAudience(`workspace:${workspaceId}`)
            .setIssuer(this.issuer())
            .setIssuedAt()
            .setExpirationTime(expiresAt)
            .sign(key);

        return { token, expiresAt };
    }
}
