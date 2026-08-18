import '../src/load-env';

import { SignJWT } from 'jose';
import { requireEnv } from '../src/db/table';

/**
 * Mints a token the control plane will accept, for manual calls.
 *
 *   npm run token <userId> [email]
 *
 * Signed with the issuer's secret and shaped like its tokens, so it goes through
 * the same verification as a real one — nothing here bypasses a check.
 */
async function main(): Promise<void> {
    const [userId, email = 'dev@example.com'] = process.argv.slice(2);

    if (!userId) {
        console.error('usage: npm run token <userId> [email]');
        process.exit(1);
    }

    const token = await new SignJWT({ email })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(userId)
        .setAudience('authenticated')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(new TextEncoder().encode(requireEnv('AUTH_JWT_SECRET')));

    console.log(token);
}

main();
