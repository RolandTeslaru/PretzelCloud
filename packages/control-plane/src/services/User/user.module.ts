import { forwardRef, Module } from '@nestjs/common';
import { WorkspaceModule } from '@/services/Workspace/workspace.module';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
    imports: [forwardRef(() => WorkspaceModule)],
    controllers: [UserController],
    providers: [UserService],
    exports: [UserService],
})
export class UserModule { }
