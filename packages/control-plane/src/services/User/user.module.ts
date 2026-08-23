import { forwardRef, Module } from '@nestjs/common';
import { WorkspaceModule } from '@/services/Workspace/workspace.module';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { UserDatabase } from './user.database';

@Module({
    imports: [forwardRef(() => WorkspaceModule)],
    controllers: [UserController],
    providers: [UserService, UserDatabase],
    exports: [UserService, UserDatabase],
})
export class UserModule { }
