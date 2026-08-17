import { Module } from '@nestjs/common';
import { MachineDriver } from './drivers/driver';
import { DockerDriver } from './drivers/docker.driver';
import { ClusterService } from './cluster/cluster.service';
import { FleetService } from './fleet.service';
import { ProvisioningService } from './provisioning/provisioning.service';

// MACHINE_DRIVER picks the substrate. Everything else in provisioning is the
// same either way.
function driverFor(kind: string | undefined): MachineDriver {
    if (kind === 'fly')
        throw new Error('MACHINE_DRIVER=fly is not implemented yet');

    return new DockerDriver();
}

@Module({
    providers: [
        { provide: MachineDriver, useFactory: () => driverFor(process.env.MACHINE_DRIVER) },
        ClusterService,
        FleetService,
        ProvisioningService,
    ],
    exports: [FleetService, ProvisioningService],
})
export class FleetModule { }
