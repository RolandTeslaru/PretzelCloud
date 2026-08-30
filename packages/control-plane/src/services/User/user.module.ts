import { forwardRef, Module } from '@nestjs/common';
import { WorkspaceModule } from '@/services/Workspace/workspace.module';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { UserRepository } from './user.repository';

@Module({
    imports: [forwardRef(() => WorkspaceModule)],
    controllers: [UserController],
    providers: [UserService, UserRepository],
    exports: [UserService, UserRepository],
})
export class UserModule { }
