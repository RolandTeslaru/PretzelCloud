import { Global, Module } from '@nestjs/common';
import { IdentityResolver, TokenIdentityResolver } from './identity';
import { UserAuthGuard } from './user-auth.guard';
import { ScopedGuard } from './scoped.guard';

@Global()
@Module({
    providers: [
        { provide: IdentityResolver, useClass: TokenIdentityResolver },
        UserAuthGuard,
        ScopedGuard,
    ],
    exports: [IdentityResolver, UserAuthGuard, ScopedGuard],
})
export class AuthModule { }
