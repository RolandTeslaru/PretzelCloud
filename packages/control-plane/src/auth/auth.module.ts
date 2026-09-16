import { Global, Module } from '@nestjs/common';
import { IdentityResolver, TokenIdentityResolver } from './identity/identity';
import { IdentityAdminService } from './identity/identity-admin.service';
import { UserAuthGuard } from './guards/user-auth.guard';
import { ScopedGuard } from './guards/scoped.guard';
import { AdminGuard } from './guards/admin.guard';
import { AdminRepository } from './admin.repository';

@Global()
@Module({
    providers: [
        { provide: IdentityResolver, useClass: TokenIdentityResolver },
        IdentityAdminService,
        UserAuthGuard,
        ScopedGuard,
        AdminGuard,
        AdminRepository,
    ],
    exports: [IdentityResolver, IdentityAdminService, UserAuthGuard, ScopedGuard, AdminGuard, AdminRepository],
})
export class AuthModule { }
