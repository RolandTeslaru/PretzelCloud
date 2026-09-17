import { Injectable } from '@nestjs/common';
import { Workspace } from '@pretzel-cloud/shared/domain';
import { Provisioning } from '@pretzel-cloud/shared/domain/Workspace/provisioning';
import { WorkspaceDB } from '@/db/workspace';
import { ClusterService } from '../cluster/cluster.service';
import { HardwareService } from '../Hardware/hardware.service';

/**
 * The one door into a workspace's own database. Everything the fleet writes
 * inside a tenant goes through here, so `reason` makes every such write
 * greppable and the cluster is resolved rather than assumed.
 */
@Injectable()
export class SiloDatabaseService {

    constructor(
        private readonly clusterService:  ClusterService,
        private readonly hardwareService: HardwareService,
    ) {}




    /** One transaction inside the named workspace's database, on its cluster's admin credential. */
    public async transact<T>(
        reason:      string,
        workspaceId: Workspace.Id,
        fn:          (trx: WorkspaceDB.Transaction) => Promise<T>,
    ): Promise<T> {
        const hardware = await this.hardwareService.getHardware(workspaceId);

        const cluster = await this.clusterService.getClusterById(hardware.clusterId);

        return WorkspaceDB.withWorkspaceDatabase(
            reason,
            this.clusterService.getAdminUrlForCluster(cluster),
            Provisioning.getDatabaseName(workspaceId),
            fn,
        );
    }
}
