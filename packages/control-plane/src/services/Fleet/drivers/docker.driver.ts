import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { AbstractHardwareDriver } from './driver';

const run = promisify(execFile);

export const WORKSPACE_LABEL = 'pretzel.workspace';
export const ROLE_LABEL      = 'pretzel.role';

// Containers report "No such object"; networks report "not found".
const ABSENT           = /no such \w+|not found/i;
const ALREADY_ATTACHED = /already exists in network/i;

// A machine that predates publishing, or one that is stopped, reports this
// rather than being absent — both mean "no address", not a failure.
const NOT_PUBLISHED = /no public port|no such \w+|not found/i;

// The port the workspace image serves on.
const SERVICE_PORT = 3001;

// Bound to loopback, and to a port Docker picks: the router reaches the machine
// from the host, and nothing on the network can.
const PUBLISH = `127.0.0.1::${SERVICE_PORT}`;

// Seconds between the stop signal and the kill. The daemon's own default is 1,
// which is short enough that a busy machine is killed before it has closed its
// database connections. The workspace image bounds its own shutdown at 10s, so
// this leaves margin rather than sitting exactly on it.
const STOP_TIMEOUT_SECONDS = 15;

@Injectable()
export class DockerDriver extends AbstractHardwareDriver {

    readonly kind = 'docker' as const;

    private readonly logger = new Logger(DockerDriver.name);

    private async docker(args: string[]): Promise<string> {
        const { stdout } = await run('docker', args);
        return stdout.trim();
    }

    /**
     * Runs a command whose target may legitimately not be there yet, or already
     * be gone. Only that is answered with null.
     *
     * Anything else — an unreachable daemon, a permission error — propagates.
     * Swallowing those would report a running machine as destroyed, and would
     * turn the existence check in `create` into a duplicate container.
     */
    private async dockerTolerating(tolerated: RegExp, args: string[]): Promise<string | null> {
        try {
            return await this.docker(args);
        }
        catch (error) {
            const detail = error as { stderr?: string; message?: string };

            if (tolerated.test(`${detail?.stderr ?? ''} ${detail?.message ?? ''}`))
                return null;

            throw error;
        }
    }

    private networkName(workspaceId: Workspace.Id): string {
        return `pretzel-${workspaceId}`;
    }

    private async ensureNetwork(workspaceId: Workspace.Id): Promise<string> {
        const name = this.networkName(workspaceId);

        const existing = await this.dockerTolerating(ABSENT, ['network', 'inspect', '-f', '{{.Id}}', name]);

        if (existing)
            return name;

        await this.docker([
            'network', 'create',
            '--label', `${WORKSPACE_LABEL}=${workspaceId}`,
            name,
        ]);

        return name;
    }

    /**
     * Environment goes through a 0600 file rather than argv — anything on the
     * command line is readable by every process on the host.
     */
    private async withEnvFile<T>(env: Record<string, string>, fn: (file: string) => Promise<T>): Promise<T> {
        const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'pretzel-env-')), 'env');

        await fs.writeFile(file, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n'), { mode: 0o600 });

        try {
            return await fn(file);
        }
        finally {
            await fs.rm(path.dirname(file), { recursive: true, force: true });
        }
    }

    private toState(status: string): Fleet.Machine.State {
        if (status === 'running')
            return 'running';

        if (status === 'paused')
            return 'suspended';

        if (status === 'created')
            return 'creating';

        return 'stopped';
    }

    /**
     * Development only. With `WORKSPACE_DEV_REPO` set, a machine runs the built
     * output on the host instead of the copy baked into its image, so a rebuild
     * is `npm run build` and a restart rather than a new image.
     *
     * Only `dist` is mounted: `node_modules` in the image is installed for the
     * container's platform and must not be replaced by the host's.
     */
    private devMounts(role: Fleet.Machine.Role): string[] {
        const repo = process.env.WORKSPACE_DEV_REPO;

        if (!repo)
            return [];

        const packages = role === 'worker'
            ? ['worker', 'nodes']
            : role === 'combined' ? ['backend', 'worker', 'nodes', 'frontend'] : ['backend', 'nodes', 'frontend'];

        const mounts = packages.flatMap((name) => ['--volume', `${repo}/packages/${name}/dist:/app/packages/${name}/dist:ro`]);

        // The image restarts its own processes when what is mounted changes, so
        // a rebuild on the host is the whole loop.
        return [...mounts, '--env', 'PRETZEL_DEV_WATCH=1'];
    }

    async create(options: AbstractHardwareDriver.CreateOptions): Promise<AbstractHardwareDriver.Handle> {
        // Idempotency: the name is derived from the workspace id, so a re-run
        // finds the container the killed run left behind.
        const existing = await this.dockerTolerating(ABSENT, ['inspect', '-f', '{{.Id}}|{{.State.Status}}', options.name]);

        if (existing) {
            const [id, status] = existing.split('|');

            this.logger.log(`Reusing ${options.name}`);

            return { resourceId: Fleet.Machine.ResourceId.parse(id), state: this.toState(status!) };
        }

        const network = await this.ensureNetwork(options.workspaceId);

        const created = await this.withEnvFile(options.env, (envFile) => this.docker([
            'run', '-d',
            '--name', options.name,
            '--network', network,
            '--publish', PUBLISH,
            '--label', `${WORKSPACE_LABEL}=${options.workspaceId}`,
            '--label', `${ROLE_LABEL}=${options.role}`,
            '--env-file', envFile,
            '--restart', 'unless-stopped',
            '--stop-timeout', String(STOP_TIMEOUT_SECONDS),
            ...this.devMounts(options.role),
            options.image,
        ]));

        const resourceId = Fleet.Machine.ResourceId.parse(created);

        // A second network, so the workspace resolves `postgres` and `gotrue` by
        // name. `docker run` takes only one, hence the separate attach.
        const infra = process.env.FLEET_INFRA_NETWORK;

        if (infra)
            await this.dockerTolerating(ALREADY_ATTACHED, ['network', 'connect', infra, resourceId]);

        this.logger.log(`Created ${options.name}`);

        return { resourceId, state: 'running' };
    }

    /**
     * The host port Docker assigned, which is chosen at `create` and changes if
     * the container is recreated — so it is read each time rather than stored.
     */
    async address(resourceId: Fleet.Machine.ResourceId): Promise<URL | null> {
        const published = await this.dockerTolerating(NOT_PUBLISHED, ['port', resourceId, String(SERVICE_PORT)]);

        if (!published)
            return null;

        // One line per binding, `127.0.0.1:54321`, and IPv6 may appear beside it.
        const port = published.split('\n')
            .map((line) => line.trim().match(/:(\d+)$/)?.[1])
            .find(Boolean);

        return port ? new URL(`http://127.0.0.1:${port}`) : null;
    }

    async start(resourceId: Fleet.Machine.ResourceId): Promise<void> {
        await this.docker(['start', resourceId]);
    }

    async stop(resourceId: Fleet.Machine.ResourceId): Promise<void> {
        // Also passed here, not just at create: machines made before the
        // container-level setting existed still carry the daemon's default.
        await this.docker(['stop', '--timeout', String(STOP_TIMEOUT_SECONDS), resourceId]);
    }

    // The cgroup freezer: processes stop being scheduled and stay resident, the
    // closest Docker comes to a VM snapshot.
    async suspend(resourceId: Fleet.Machine.ResourceId): Promise<void> {
        await this.docker(['pause', resourceId]);
    }

    async resume(resourceId: Fleet.Machine.ResourceId): Promise<void> {
        await this.docker(['unpause', resourceId]);
    }

    async destroy(resourceId: Fleet.Machine.ResourceId): Promise<void> {
        await this.dockerTolerating(ABSENT, ['rm', '-f', resourceId]);
    }

    async status(resourceId: Fleet.Machine.ResourceId): Promise<Fleet.Machine.State> {
        const status = await this.dockerTolerating(ABSENT, ['inspect', '-f', '{{.State.Status}}', resourceId]);

        // Gone from the daemon is the terminal state, not an error.
        return status ? this.toState(status) : 'destroyed';
    }

    async health(resourceId: Fleet.Machine.ResourceId): Promise<AbstractHardwareDriver.Health> {
        const status = await this.dockerTolerating(ABSENT, [
            'inspect', '-f', '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}', resourceId,
        ]);

        if (status === 'healthy' || status === 'starting' || status === 'unhealthy')
            return status;

        return 'unknown';
    }

    async findByWorkspace(workspaceId: Workspace.Id): Promise<AbstractHardwareDriver.Handle[]> {
        const output = await this.docker([
            'ps', '-a',
            '--filter', `label=${WORKSPACE_LABEL}=${workspaceId}`,
            '--format', '{{.ID}}|{{.State}}',
        ]);

        if (!output)
            return [];

        return output.split('\n').map((line) => {
            const [id, state] = line.split('|');
            return { resourceId: Fleet.Machine.ResourceId.parse(id), state: this.toState(state!) };
        });
    }

    // The container name, which the workspace network's own resolver answers for.
    async getInternalHostForMachine(resourceId: Fleet.Machine.ResourceId): Promise<string> {
        const name = await this.docker(['inspect', '-f', '{{.Name}}', resourceId]);

        return name.replace(/^\//, '');
    }

    /** The per-workspace network, removed once its containers are gone. */
    async destroyScope(workspaceId: Workspace.Id): Promise<void> {
        await this.dockerTolerating(ABSENT, ['network', 'rm', this.networkName(workspaceId)]);
    }
}
