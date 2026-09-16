import { forwardRef, Module } from '@nestjs/common';
import { WorkspaceModule } from '@/services/Workspace/workspace.module';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { UserRepository } from './user.repository';
import { UserAdminController } from './user.admin.controller';
import { UserAdminService } from './user.admin.service';
import { UserAdminRepository } from './user.admin.repository';

@Module({
    imports: [forwardRef(() => WorkspaceModule)],
    controllers: [UserController, UserAdminController],
    providers: [UserService, UserAdminService, UserRepository, UserAdminRepository],
    exports: [UserService, UserRepository, UserAdminRepository],
})
export class UserModule { }
