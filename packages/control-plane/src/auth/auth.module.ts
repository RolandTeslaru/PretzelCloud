import { Global, Module } from '@nestjs/common';
import { IdentityResolver, TokenIdentityResolver } from './identity/identity';
import { IdentityAdminService } from './identity/identity-admin.service';
import { UserAuthGuard } from './guards/user-auth.guard';
import { ScopedGuard } from './guards/scoped.guard';
import { OperatorGuard } from './guards/operator.guard';

@Global()
@Module({
    providers: [
        { provide: IdentityResolver, useClass: TokenIdentityResolver },
        IdentityAdminService,
        UserAuthGuard,
        ScopedGuard,
        OperatorGuard,
    ],
    exports: [IdentityResolver, IdentityAdminService, UserAuthGuard, ScopedGuard, OperatorGuard],
})
export class AuthModule { }
