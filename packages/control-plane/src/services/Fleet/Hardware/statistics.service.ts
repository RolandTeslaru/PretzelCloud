import { Injectable } from '@nestjs/common';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { Provisioning } from '@pretzel-cloud/shared/domain/Workspace/provisioning';
import { Principal } from '@/auth/identity/principal';
import { DriverRegistry } from '../drivers/driver.registry';
import { MachineRepository } from '../Machine/machine.repository';
import { ClusterService } from '../cluster/cluster.service';
import { HardwareRepository } from './hardware.repository';

/** Readings off a workspace's machines and its database. */
@Injectable()
export class HardwareStatisticsService {

    constructor(
        private readonly repository:        HardwareRepository,
        private readonly driverRegistry:    DriverRegistry,
        private readonly machineRepository: MachineRepository,
        private readonly clusterService:    ClusterService,
    ) {}




    /** One reading per running machine. Null when nothing is running to read. */
    public async getStatistics(workspaceId: Workspace.Id): Promise<Workspace.HardwareStatistics | null> {
        const hardware = await this.repository.getByWorkspace(Principal.SELF, workspaceId);

        if (!hardware)
            return null;

        const machines = await this.machineRepository.getAll(Principal.SELF, workspaceId);

        const driver = this.driverRegistry.getDriverForKind(hardware.driver);

        const readings = await Promise.all(machines.map(async (machine) => ({
            machine,
            statistics: await driver.statistics(machine.resourceId).catch(() => null),
        })));

        const statisticsByMachineId: Record<Fleet.Machine.Id, Fleet.Machine.Statistics> = {};

        for (const { machine, statistics } of readings) {
            statisticsByMachineId[machine.id] = {
                role:          machine.role,
                // A reading proves it is running whatever the row last recorded.
                state:         statistics ? 'running' : machine.state,
                cpuPercent:    statistics?.cpuPercent    ?? null,
                memUsedBytes:  statistics?.memUsedBytes  ?? null,
                memTotalBytes: statistics?.memTotalBytes ?? null,
            };
        }

        if (Object.keys(statisticsByMachineId).length === 0)
            return null;

        const cluster = await this.clusterService.getClusterById(hardware.cluster_id);

        const databaseSizeBytes = await this.clusterService
            .getDatabaseSizeBytes(cluster, Provisioning.getDatabaseName(workspaceId))
            .catch(() => null);

        return { machines: statisticsByMachineId, databaseSizeBytes, capturedAt: new Date() };
    }
}
