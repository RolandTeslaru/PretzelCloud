import { Module } from '@nestjs/common';
import { WorkspaceTokenIssuerModule } from '@/services/WorkspaceSession/token-issuer.module';
import { AbstractHardwareDriver } from './drivers/driver';
import { DockerDriver } from './drivers/docker.driver';
import { ClusterService } from './cluster/cluster.service';
import { WorkspaceSecretsDatabase } from './WorkspaceSecrets/workspace-secrets.database';
import { WorkspaceSecretsService } from './WorkspaceSecrets/workspace-secrets.service';
import { MachineDatabase } from './Machine/machine.database';
import { MachineService } from './Machine/machine.service';
import { HardwareDatabase } from './Hardware/hardware.database';
import { HardwareService } from './Hardware/hardware.service';
import { HostnameDatabase } from './Hostname/hostname.database';
import { HostnameService } from './Hostname/hostname.service';
import { ProvisioningService } from './provisioning/provisioning.service';

// MACHINE_DRIVER picks the substrate. Everything else in provisioning is the
// same either way.
function driverFor(kind: string | undefined): AbstractHardwareDriver {
    if (kind === 'fly')
        throw new Error('MACHINE_DRIVER=fly is not implemented yet');

    return new DockerDriver();
}

@Module({
    imports: [WorkspaceTokenIssuerModule],
    providers: [
        { provide: AbstractHardwareDriver, useFactory: () => driverFor(process.env.MACHINE_DRIVER) },
        ClusterService,
        WorkspaceSecretsDatabase, WorkspaceSecretsService,
        MachineDatabase, MachineService,
        HardwareDatabase, HardwareService,
        HostnameDatabase, HostnameService,
        ProvisioningService,
    ],
    // Hardware is the fleet's façade; the router needs the driver's address().
    exports: [HardwareService, HostnameService, ProvisioningService, AbstractHardwareDriver],
})
export class FleetModule { }
