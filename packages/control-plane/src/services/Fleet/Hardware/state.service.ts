import { Injectable } from '@nestjs/common';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { Principal } from '@/auth/identity/principal';
import { DriverRegistry } from '../drivers/driver.registry';
import { MachineService } from '../Machine/machine.service';
import { MachineRepository } from '../Machine/machine.repository';
import { HardwareRepository } from './hardware.repository';
import { HardwareStatisticsSampler } from './statistics.sampler';

/** What a workspace's compute is doing right now, and the writes that record a reading. */
@Injectable()
export class HardwareStateService {

    constructor(
        private readonly repository:        HardwareRepository,
        private readonly driverRegistry:    DriverRegistry,
        private readonly machineService:    MachineService,
        private readonly machineRepository: MachineRepository,
        private readonly statisticsSampler: HardwareStatisticsSampler,
    ) {}




    /** Whether the workspace answers right now. The cheap check before waking: writes nothing. */
    async isServing(workspaceId: Workspace.Id): Promise<boolean> {
        const backend = await this.machineService.getByRole(workspaceId, ['backend', 'combined']);

        if (!backend)
            return false;

        const driver = this.driverRegistry.getDriverForKind(backend.driver);

        if (await this.machineService.getState(driver, backend.resourceId) !== 'running')
            return false;

        // `unknown` covers an image that declares no health check at all.
        return await this.machineService.health(driver, backend.resourceId) !== 'unhealthy';
    }




    /** Whether there is anything to start; the hardware row outlives the machines. */
    async hasMachines(workspaceId: Workspace.Id): Promise<boolean> {
        const machines = await this.machineService.getAll(workspaceId);

        return machines.length > 0;
    }




    /** A running worker means work is in flight. */
    async hasRunningWorker(workspaceId: Workspace.Id): Promise<boolean> {
        const worker = await this.machineService.getByRole(workspaceId, ['worker']);

        if (!worker)
            return false;

        const driver = this.driverRegistry.getDriverForKind(worker.driver);

        const state = await this.machineService.refreshState(driver, worker);

        return state === 'running';
    }




    /** The state each of many workspaces presents, for the grid. */
    async getStates(workspaceIds: Workspace.Id[]): Promise<Map<Workspace.Id, Fleet.Machine.State>> {
        if (workspaceIds.length === 0)
            return new Map();

        const rows = await this.machineRepository.getStatesByWorkspaces(Principal.SELF, workspaceIds);

        const map = new Map<Workspace.Id, Fleet.Machine.State>();

        // The backend's state is the hardware's; a worker between jobs is not a workspace down.
        for (const row of rows)
            if (row.role === 'backend' || row.role === 'combined')
                map.set(row.workspace_id, Fleet.Machine.State.parse(row.state));

        return map;
    }




    /** Where the router forwards a workspace's traffic, or null when asleep. */
    async getBackendAddress(workspaceId: Workspace.Id): Promise<URL | null> {
        const backend = await this.machineService.getByRole(workspaceId, ['backend', 'combined']);

        if (!backend)
            return null;

        const driver = this.driverRegistry.getDriverForKind(backend.driver);

        const address = await this.machineService.address(driver, backend.resourceId);

        return address;
    }




    /** Brings every recorded state back in line with what the driver reports. */
    async refreshAll(workspaceId: Workspace.Id): Promise<void> {
        const machines = await this.machineService.getAll(workspaceId);

        for (const machine of machines) {
            const driver = this.driverRegistry.getDriverForKind(machine.driver);

            await this.machineService.refreshState(driver, machine);
        }

        // The states just moved; a reading taken before them describes machines
        // that no longer run that way.
        this.statisticsSampler.invalidate(workspaceId);
    }




    /** Marks the workspace as used just now. */
    async touch(workspaceId: Workspace.Id): Promise<void> {
        await this.repository.touch(Principal.SELF, workspaceId);
    }




    /** When each workspace was last used, for the idle sweep. */
    getLastSeen(): Promise<{ workspaceId: Workspace.Id; lastSeenAt: Date }[]> {
        return this.repository.getLastSeen(Principal.SELF);
    }
}
