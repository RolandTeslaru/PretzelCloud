import { Global, Module } from '@nestjs/common';
import { IdentityResolver, TokenIdentityResolver } from './identity';
import { IdentityAdminService } from './identity-admin.service';
import { UserAuthGuard } from './user-auth.guard';
import { ScopedGuard } from './scoped.guard';

@Global()
@Module({
    providers: [
        { provide: IdentityResolver, useClass: TokenIdentityResolver },
        IdentityAdminService,
        UserAuthGuard,
        ScopedGuard,
    ],
    exports: [IdentityResolver, IdentityAdminService, UserAuthGuard, ScopedGuard],
})
export class AuthModule { }
