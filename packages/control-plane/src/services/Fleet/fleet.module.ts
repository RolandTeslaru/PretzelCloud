import { Module } from '@nestjs/common';
import { SiloTokenIssuerModule } from '@/services/SiloSession/token-issuer.module';
import { HardwareDriverRegistry } from './drivers/driver.registry';
import { ClusterDatabase } from './cluster/cluster.database';
import { ClusterService } from './cluster/cluster.service';
import { SiloSecretsDatabase } from './SiloSecrets/silo-secrets.database';
import { SiloSecretsService } from './SiloSecrets/silo-secrets.service';
import { MachineDatabase } from './Machine/machine.database';
import { MachineService } from './Machine/machine.service';
import { HardwareDatabase } from './Hardware/hardware.database';
import { HardwareService } from './Hardware/hardware.service';
import { HostnameDatabase } from './Hostname/hostname.database';
import { HostnameService } from './Hostname/hostname.service';
import { SiloDatabase } from './Silo/silo.database';
import { SiloDatabaseService } from './Silo/silo-database.service';
import { ProvisioningService } from './provisioning/provisioning.service';

@Module({
    imports: [SiloTokenIssuerModule],
    providers: [
        HardwareDriverRegistry,
        ClusterDatabase, ClusterService,
        SiloSecretsDatabase, SiloSecretsService,
        MachineDatabase, MachineService,
        HardwareDatabase, HardwareService,
        HostnameDatabase, HostnameService,
        SiloDatabase, SiloDatabaseService,
        ProvisioningService,
    ],
    // Hardware is the fleet's façade; everything above it goes through one of these.
    exports: [HardwareService, HostnameService, ProvisioningService, SiloDatabaseService, SiloDatabase],
})
export class FleetModule { }
