import { Injectable } from '@nestjs/common';
import { Fleet } from '@pretzel-cloud/shared/domain';
import { AbstractHardwareDriver } from './driver';
import { DockerDriver } from './docker.driver';
import { FlyDriver } from './fly.driver';

/**
 * The driver a machine belongs to, chosen from what its hardware recorded rather
 * than from this process's configuration. Two substrates can therefore hold
 * workspaces at once, and a fleet can move between them one workspace at a time.
 */
@Injectable()
export class DriverRegistry {

    // Stateless, so one of each is all a process ever needs.
    private readonly drivers: Record<Fleet.Driver.Kind, AbstractHardwareDriver> = {
        docker: new DockerDriver(),
        fly:    new FlyDriver(),
    };

    public getDriverForKind(kind: Fleet.Driver.Kind): AbstractHardwareDriver {
        return this.drivers[kind];
    }

    /** What a workspace built from now on runs on. Nothing existing is affected. */
    public getKindForNewWorkspaces(): Fleet.Driver.Kind {
        return Fleet.Driver.Kind.parse(process.env.MACHINE_DRIVER ?? 'docker');
    }

    public getDriverForNewWorkspaces(): AbstractHardwareDriver {
        return this.getDriverForKind(this.getKindForNewWorkspaces());
    }
}
