import { Module } from '@nestjs/common';
import { SiloTokenIssuerModule } from '@/services/SiloSession/token-issuer.module';
import { RealtimeModule } from '@/services/Realtime/realtime.module';
import { LockModule } from '@/services/Locking/lock.module';
import { HardwareDriverRegistry } from './drivers/driver.registry';
import { ClusterRepository } from './cluster/cluster.repository';
import { ClusterService } from './cluster/cluster.service';
import { SiloSecretsRepository } from './SiloSecrets/silo-secrets.repository';
import { SiloSecretsService } from './SiloSecrets/silo-secrets.service';
import { MachineRepository } from './Machine/machine.repository';
import { MachineService } from './Machine/machine.service';
import { HardwareRepository } from './Hardware/hardware.repository';
import { HardwareService } from './Hardware/hardware.service';
import { HardwareStatisticsSampler } from './Hardware/hardware-statistics.sampler';
import { HardwareStatisticsCache } from './Hardware/hardware-statistics.cache';
import { HostnameRepository } from './Hostname/hostname.repository';
import { HostnameService } from './Hostname/hostname.service';
import { SiloDatabase } from './Silo/silo.database';
import { SiloDatabaseService } from './Silo/silo-database.service';
import { ProvisioningService } from './provisioning/provisioning.service';
import { ReleaseRepository } from './Release/release.repository';
import { ReleaseService } from './Release/release.service';
import { ReleaseController } from './Release/release.controller';

@Module({
    imports: [SiloTokenIssuerModule, RealtimeModule, LockModule],
    providers: [
        HardwareDriverRegistry,
        ClusterRepository, ClusterService,
        SiloSecretsRepository, SiloSecretsService,
        MachineRepository, MachineService,
        HardwareRepository, HardwareService, HardwareStatisticsSampler, HardwareStatisticsCache,
        HostnameRepository, HostnameService,
        SiloDatabase, SiloDatabaseService,
        ProvisioningService,
        ReleaseRepository, ReleaseService,
    ],
    controllers: [ReleaseController],
    // Hardware is the fleet's façade; everything above it goes through one of these.
    exports: [HardwareService, ReleaseService, HardwareStatisticsSampler, HardwareStatisticsCache, HostnameService, ProvisioningService, SiloDatabaseService, SiloDatabase],
})
export class FleetModule { }
