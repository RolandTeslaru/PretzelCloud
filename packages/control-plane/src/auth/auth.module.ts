import { Global, Module } from '@nestjs/common';
import { IdentityResolver, DevIdentityResolver } from './identity';
import { UserService } from './user.service';
import { UserAuthGuard } from './user-auth.guard';
import { ScopedGuard } from './scoped.guard';

// One binding to change when token verification lands.
@Global()
@Module({
    providers: [
        { provide: IdentityResolver, useClass: DevIdentityResolver },
        UserService,
        UserAuthGuard,
        ScopedGuard,
    ],
    exports: [IdentityResolver, UserService, UserAuthGuard, ScopedGuard],
})
export class AuthModule { }
