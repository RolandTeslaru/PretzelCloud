import { Module } from '@nestjs/common';
import { WorkspaceTokenIssuerModule } from '@/services/WorkspaceSession/token-issuer.module';
import { HardwareDriverRegistry } from './drivers/driver.registry';
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

@Module({
    imports: [WorkspaceTokenIssuerModule],
    providers: [
        HardwareDriverRegistry,
        ClusterService,
        WorkspaceSecretsDatabase, WorkspaceSecretsService,
        MachineDatabase, MachineService,
        HardwareDatabase, HardwareService,
        HostnameDatabase, HostnameService,
        ProvisioningService,
    ],
    // Hardware is the fleet's façade; everything above it goes through one of these.
    exports: [HardwareService, HostnameService, ProvisioningService],
})
export class FleetModule { }
