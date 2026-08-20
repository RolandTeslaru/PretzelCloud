import { Module } from '@nestjs/common';
import { WorkspaceTokenIssuer } from './token-issuer.service';

/** Dependency-free on purpose: both the session and fleet modules import it. */
@Module({
    providers: [WorkspaceTokenIssuer],
    exports:   [WorkspaceTokenIssuer],
})
export class WorkspaceTokenIssuerModule { }
