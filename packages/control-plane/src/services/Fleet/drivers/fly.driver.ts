import { Injectable, Logger } from '@nestjs/common';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { requireEnv } from '@/db/table';
import { AbstractHardwareDriver } from './driver';

const Fly = Fleet.Driver.Fly;

// A worker listens on nothing, and a machine with no check reports `unknown`, which is read as ready.
function getChecksForRole(role: Fleet.Machine.Role): Record<string, unknown> {
    return role === 'worker' ? {} : Fly.SERVING_CHECK;
}

type FlyMachine = {
    id:     string;
    name:   string;
    state:  string;
    checks?: { name: string; status: string }[];
};

@Injectable()
export class FlyDriver extends AbstractHardwareDriver {

    public readonly kind = 'fly' as const;

    private readonly logger = new Logger(FlyDriver.name);

    // Read on use, not at construction: a deployment that never provisions onto Fly must not be made to configure it.
    private get app(): string {
        return requireEnv('FLY_APP');
    }

    private get token(): string {
        return requireEnv('FLY_API_TOKEN');
    }


    private get org(): string {
        return requireEnv('FLY_ORG');
    }

    // A macaroon is itself the authorization scheme; older personal access tokens are bearer tokens.
    private authorization(): string {
        return this.token.startsWith('FlyV1') ? this.token : `Bearer ${this.token}`;
    }

    private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
        const response = await fetch(`${Fly.API}/apps/${this.app}${path}`, {
            method,
            headers: {
                Authorization:  this.authorization(),
                'Content-Type': 'application/json',
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });

        if (!response.ok)
            throw new Error(`Fly ${method} ${path} failed: ${response.status} ${await response.text()}`);

        return response.status === 204 ? undefined as T : await response.json() as T;
    }

    /** Null where the target may legitimately be gone; anything else propagates. */
    private async callTolerating404<T>(method: string, path: string, body?: unknown): Promise<T | null> {
        try {
            return await this.call<T>(method, path, body);
        }
        catch (error) {
            if (error instanceof Error && / 404 /.test(error.message))
                return null;

            throw error;
        }
    }

    // A lifecycle POST returns once the platform accepts it, not once it applies; the next one is rejected until it has.
    private async awaitSettled(resourceId: Fleet.Machine.ResourceId, state: Fleet.Driver.Fly.SettledState): Promise<void> {
        await this.callTolerating404('GET', `/machines/${resourceId}/wait?state=${state}&timeout=${Fly.WAIT_TIMEOUT_SECONDS}`);
    }

    /** The first value an instant query returns, or null when the series is absent. */
    private async promInstant(query: string): Promise<number | null> {
        const url = new URL(`https://api.fly.io/prometheus/${this.org}/api/v1/query`);

        url.searchParams.set('query', query);

        const response = await fetch(url, { headers: { Authorization: this.authorization() } });

        if (!response.ok)
            throw new Error(`Fly metrics query failed: ${response.status} ${await response.text()}`);

        const body = await response.json() as { data?: { result?: { value: [number, string] }[] } };

        const value = body.data?.result?.[0]?.value?.[1];

        return value === undefined ? null : Number(value);
    }

    /** From the platform's metrics: a machine that is not running has no series, and null is the answer. */
    public async statistics(resourceId: Fleet.Machine.ResourceId): Promise<AbstractHardwareDriver.Statistics | null> {
        const instance = `instance="${resourceId}"`;

        const [memTotalBytes, memAvailableBytes, idleTicksPerSecond] = await Promise.all([
            this.promInstant(`fly_instance_memory_mem_total{${instance}}`),
            this.promInstant(`fly_instance_memory_mem_available{${instance}}`),
            this.promInstant(`avg(rate(fly_instance_cpu{${instance},mode="idle"}[60s]))`),
        ]);

        if (memTotalBytes === null || memAvailableBytes === null || idleTicksPerSecond === null)
            return null;

        // The counter ticks 100 times a second per fully idle CPU, so the averaged idle rate is already a percentage.
        return {
            cpuPercent:    Math.min(100, Math.max(0, 100 - idleTicksPerSecond)),
            memUsedBytes:  memTotalBytes - memAvailableBytes,
            memTotalBytes,
        };
    }

    private toState(state: string): Fleet.Machine.State {
        if (state === 'started')
            return 'running';

        // Reported while the snapshot is still being taken, and it resumes from there — a stop it is not.
        if (state === 'suspended' || state === 'suspending')
            return 'suspended';

        if (state === 'created' || state === 'starting' || state === 'replacing')
            return 'creating';

        if (state === 'destroyed' || state === 'destroying')
            return 'destroyed';

        return 'stopped';
    }

    /** `shared-1x-512` and `performance-2x-4096` are cpu kind, count and memory. */
    private toGuest(size: string): { cpu_kind: string; cpus: number; memory_mb: number } {
        const parsed = /^(shared|performance)-(\d+)x-(\d+)$/.exec(size);

        if (!parsed)
            throw new Error(`Unrecognised machine size: ${size}`);

        return { cpu_kind: parsed[1]!, cpus: Number(parsed[2]), memory_mb: Number(parsed[3]) };
    }

    private async findByName(name: string): Promise<FlyMachine | undefined> {
        const machines = await this.call<FlyMachine[]>('GET', '/machines');

        return machines.find((machine) => machine.name === name);
    }

    public async create(options: AbstractHardwareDriver.CreateOptions): Promise<AbstractHardwareDriver.Handle> {
        // Idempotency: the name is derived from the workspace id, so a re-run finds what the killed run left behind.
        const existing = await this.findByName(options.name);

        if (existing) {
            this.logger.log(`Reusing ${options.name}`);

            return { resourceId: Fleet.Machine.ResourceId.parse(existing.id), state: this.toState(existing.state) };
        }

        const created = await this.call<FlyMachine>('POST', '/machines', {
            name:   options.name,
            region: Fleet.Region.getFlyRegion(options.region),
            config: {
                image:    options.image,
                env:      options.env,
                guest:    this.toGuest(options.size),
                checks:   getChecksForRole(options.role),
                restart:  { policy: 'on-failure' },
                metadata: {
                    [Fly.WORKSPACE_METADATA]: options.workspaceId,
                    [Fly.ROLE_METADATA]:      options.role,
                },
            },
        });

        this.logger.log(`Created ${options.name}`);

        return { resourceId: Fleet.Machine.ResourceId.parse(created.id), state: this.toState(created.state) };
    }

    /** The private name the platform gives every machine, resolvable only from inside the organization's network. */
    public async address(resourceId: Fleet.Machine.ResourceId): Promise<URL | null> {
        const machine = await this.callTolerating404<FlyMachine>('GET', `/machines/${resourceId}`);

        if (!machine)
            return null;

        const state = this.toState(machine.state);

        // Only a running machine answers. Forwarding into a suspended one hangs.
        if (state !== 'running')
            return null;

        return new URL(`http://${resourceId}.vm.${this.app}.internal:${Fly.SERVICE_PORT}`);
    }

    public async start(resourceId: Fleet.Machine.ResourceId): Promise<void> {
        await this.call('POST', `/machines/${resourceId}/start`);

        await this.awaitSettled(resourceId, 'started');
    }

    public async stop(resourceId: Fleet.Machine.ResourceId): Promise<void> {
        await this.call('POST', `/machines/${resourceId}/stop`, {
            signal:  'SIGTERM',
            timeout: `${Fly.STOP_TIMEOUT_SECONDS}s`,
        });

        await this.awaitSettled(resourceId, 'stopped');
    }

    // Memory is snapshotted and the machine stays scheduled nowhere, so a resume skips the boot.
    public async suspend(resourceId: Fleet.Machine.ResourceId): Promise<void> {
        await this.call('POST', `/machines/${resourceId}/suspend`);

        await this.awaitSettled(resourceId, 'suspended');
    }

    // The same call that starts a stopped one; the platform knows which it is.
    public async resume(resourceId: Fleet.Machine.ResourceId): Promise<void> {
        await this.start(resourceId);
    }

    public async destroy(resourceId: Fleet.Machine.ResourceId): Promise<void> {
        await this.callTolerating404('DELETE', `/machines/${resourceId}?force=true`);

        await this.awaitSettled(resourceId, 'destroyed');
    }

    public async status(resourceId: Fleet.Machine.ResourceId): Promise<Fleet.Machine.State> {
        const machine = await this.callTolerating404<FlyMachine>('GET', `/machines/${resourceId}`);

        // Gone from the platform is the terminal state, not an error.
        return machine ? this.toState(machine.state) : 'destroyed';
    }

    public async health(resourceId: Fleet.Machine.ResourceId): Promise<AbstractHardwareDriver.Health> {
        const machine = await this.callTolerating404<FlyMachine>('GET', `/machines/${resourceId}`);

        if (!machine?.checks?.length)
            return 'unknown';

        if (machine.checks.some((check) => check.status === 'critical'))
            return 'unhealthy';

        return machine.checks.every((check) => check.status === 'passing') ? 'healthy' : 'starting';
    }

    public async findByWorkspace(workspaceId: Workspace.Id): Promise<AbstractHardwareDriver.Handle[]> {
        const machines = await this.call<FlyMachine[]>('GET', `/machines?metadata.${Fly.WORKSPACE_METADATA}=${workspaceId}`);

        return machines.map((machine) => ({
            resourceId: Fleet.Machine.ResourceId.parse(machine.id),
            state:      this.toState(machine.state),
        }));
    }

    // Machine names are not registered; the id is the only name that resolves.
    public async getInternalHostForMachine(resourceId: Fleet.Machine.ResourceId): Promise<string> {
        return `${resourceId}.vm.${this.app}.internal`;
    }

    /** Nothing beyond the machines: the network belongs to the app, not a workspace. */
    public async destroyScope(): Promise<void> {}
}
