import { Module } from '@nestjs/common';
import { SiloTokenIssuer } from './token-issuer.service';

/** Dependency-free on purpose: both the session and fleet modules import it. */
@Module({
    providers: [SiloTokenIssuer],
    exports:   [SiloTokenIssuer],
})
export class SiloTokenIssuerModule { }
