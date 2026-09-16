import { ConflictException, Injectable } from '@nestjs/common';
import { User, Workspace } from '@pretzel-cloud/shared/domain';
import { Principal } from '@/auth/identity/principal';
import { Operation } from '@/decorators/operation';
import { LockService } from '@/services/Locking/lock.service';
import { SiloDatabaseService } from '@/services/Fleet/Silo/silo-database.service';
import { SiloDatabase } from '@/services/Fleet/Silo/silo.database';
import { WorkspaceRepository } from './workspace.repository';

/** Membership inside a workspace's own database, as the control plane changes it. */
@Injectable()
export class WorkspaceMemberService {

    constructor(
        private readonly workspaceRepository: WorkspaceRepository,
        private readonly siloDatabaseService: SiloDatabaseService,
        private readonly siloDatabase:        SiloDatabase,
        // Read by `@Operation`, which serialises a workspace's operations across instances.
        private readonly lockService:         LockService,
    ) {}

    @Operation('workspace')
    public async remove(workspaceId: Workspace.Id, userId: User.Id): Promise<void> {
        const workspace = await this.workspaceRepository.get(Principal.SELF, workspaceId);

        if (workspace.ownerId === userId || workspace.lifecycleState === 'creating')
            throw new ConflictException('Workspace ownership or provisioning changed. Retry account deletion.');

        await this.siloDatabaseService.transact('remove deleted account from joined workspace', workspaceId,
            (trx) => this.siloDatabase.deleteUser(trx, userId));
    }
}
