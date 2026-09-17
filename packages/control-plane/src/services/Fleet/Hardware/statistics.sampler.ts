import { Injectable } from '@nestjs/common';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { Provisioning } from '@pretzel-cloud/shared/domain/Workspace/provisioning';
import { DriverRegistry } from '../drivers/driver.registry';
import { ClusterService } from '../cluster/cluster.service';

/** Readings off a workspace's machines and its database. */
@Injectable()
export class HardwareStatisticsSampler {

    constructor(
        private readonly driverRegistry:    DriverRegistry,
        private readonly clusterService:    ClusterService,
    ) {}


    

    /** One reading per machine of the hardware, plus its database. Null when it has no machines. */
    public async sampleHardware(hardware: Fleet.Hardware): Promise<Workspace.HardwareStatistics | null> {
        const readings = await Promise.all(hardware.machines.map(async (machine) => ({
            machineId:  machine.id,
            statistics: await this.sampleMachine(machine),
        })));

        const statisticsByMachineId: Record<Fleet.Machine.Id, Fleet.Machine.Statistics> = {};

        for (const { machineId, statistics } of readings)
            statisticsByMachineId[machineId] = statistics;

        if (Object.keys(statisticsByMachineId).length === 0)
            return null;

        const cluster = await this.clusterService.getClusterById(hardware.clusterId);

        const databaseSizeBytes = await this.clusterService
            .getDatabaseSizeBytes(cluster, Provisioning.getDatabaseName(hardware.workspaceId))
            .catch(() => null);

        return { machines: statisticsByMachineId, databaseSizeBytes, capturedAt: new Date() };
    }




    /** One machine's reading; its resource use is null when it is not running. */
    public async sampleMachine(machine: Fleet.Machine): Promise<Fleet.Machine.Statistics> {
        const driver = this.driverRegistry.getDriverForKind(machine.driver);

        const statistics = await driver.statistics(machine.resourceId).catch(() => null);

        return {
            role:          machine.role,
            // A reading proves it is running whatever the row last recorded.
            state:         statistics ? 'running' : machine.state,
            cpuPercent:    statistics?.cpuPercent    ?? null,
            memUsedBytes:  statistics?.memUsedBytes  ?? null,
            memTotalBytes: statistics?.memTotalBytes ?? null,
        };
    }
}
