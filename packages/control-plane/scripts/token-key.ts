import { generateKeyPair, exportJWK, calculateJwkThumbprint } from 'jose';

/**
 * Mints the workspace-token signing keypair, once. Prints the private half as
 * the env line the control plane reads; the public half is derived from it at
 * runtime, so nothing else needs storing.
 */
async function main(): Promise<void> {
    const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });

    const priv = await exportJWK(privateKey);
    const pub  = await exportJWK(publicKey);

    // The key id is the RFC 7638 thumbprint, so it is stable and collision-free.
    const kid = await calculateJwkThumbprint(pub);

    Object.assign(priv, { kid, alg: 'ES256', use: 'sig' });
    Object.assign(pub,  { kid, alg: 'ES256', use: 'sig' });

    console.log(`WORKSPACE_TOKEN_PRIVATE_JWK=${JSON.stringify(priv)}`);
    console.log(`# public half, for reference — derived at runtime, not stored:`);
    console.log(`# ${JSON.stringify(pub)}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
