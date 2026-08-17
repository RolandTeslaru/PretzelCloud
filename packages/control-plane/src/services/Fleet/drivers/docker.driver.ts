import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { MachineDriver, CreateOptions, MachineHandle } from './driver';

const run = promisify(execFile);

export const WORKSPACE_LABEL = 'pretzel.workspace';
export const ROLE_LABEL      = 'pretzel.role';

@Injectable()
export class DockerDriver extends MachineDriver {

    readonly kind = 'docker' as const;

    private readonly logger = new Logger(DockerDriver.name);

    private async docker(args: string[]): Promise<string> {
        const { stdout } = await run('docker', args);
        return stdout.trim();
    }

    /** Docker's own "not found" is an expected answer, not a failure. */
    private async dockerOrNull(args: string[]): Promise<string | null> {
        try {
            return await this.docker(args);
        }
        catch {
            return null;
        }
    }

    private networkName(workspaceId: Workspace.Id): string {
        return `pretzel-${workspaceId}`;
    }

    private async ensureNetwork(workspaceId: Workspace.Id): Promise<string> {
        const name = this.networkName(workspaceId);

        const existing = await this.dockerOrNull(['network', 'inspect', '-f', '{{.Id}}', name]);

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
            return 'started';

        if (status === 'created')
            return 'creating';

        return 'stopped';
    }

    async create(options: CreateOptions): Promise<MachineHandle> {
        // Idempotency: the name is derived from the workspace id, so a re-run
        // finds the container the killed run left behind.
        const existing = await this.dockerOrNull(['inspect', '-f', '{{.Id}}|{{.State.Status}}', options.name]);

        if (existing) {
            const [id, status] = existing.split('|');

            this.logger.log(`Reusing ${options.name}`);

            return { externalId: Fleet.Machine.ExternalId.parse(id), state: this.toState(status!) };
        }

        const network = await this.ensureNetwork(options.workspaceId);

        const created = await this.withEnvFile(options.env, (envFile) => this.docker([
            'run', '-d',
            '--name', options.name,
            '--network', network,
            '--label', `${WORKSPACE_LABEL}=${options.workspaceId}`,
            '--label', `${ROLE_LABEL}=${options.role}`,
            '--env-file', envFile,
            '--restart', 'unless-stopped',
            options.image,
        ]));

        const externalId = Fleet.Machine.ExternalId.parse(created);

        // A second network, so the workspace resolves `postgres` and `gotrue` by
        // name. `docker run` takes only one, hence the separate attach.
        const infra = process.env.FLEET_INFRA_NETWORK;

        if (infra)
            await this.dockerOrNull(['network', 'connect', infra, externalId]);

        this.logger.log(`Created ${options.name}`);

        return { externalId, state: 'started' };
    }

    async start(externalId: Fleet.Machine.ExternalId): Promise<void> {
        await this.docker(['start', externalId]);
    }

    async stop(externalId: Fleet.Machine.ExternalId): Promise<void> {
        await this.docker(['stop', externalId]);
    }

    async destroy(externalId: Fleet.Machine.ExternalId): Promise<void> {
        await this.dockerOrNull(['rm', '-f', externalId]);
    }

    async status(externalId: Fleet.Machine.ExternalId): Promise<Fleet.Machine.State> {
        const status = await this.dockerOrNull(['inspect', '-f', '{{.State.Status}}', externalId]);

        // Gone from the daemon is the terminal state, not an error.
        return status ? this.toState(status) : 'destroyed';
    }

    async findByWorkspace(workspaceId: Workspace.Id): Promise<MachineHandle[]> {
        const output = await this.docker([
            'ps', '-a',
            '--filter', `label=${WORKSPACE_LABEL}=${workspaceId}`,
            '--format', '{{.ID}}|{{.State}}',
        ]);

        if (!output)
            return [];

        return output.split('\n').map((line) => {
            const [id, state] = line.split('|');
            return { externalId: Fleet.Machine.ExternalId.parse(id), state: this.toState(state!) };
        });
    }

    /** Removes the per-workspace network once its containers are gone. */
    async destroyNetwork(workspaceId: Workspace.Id): Promise<void> {
        await this.dockerOrNull(['network', 'rm', this.networkName(workspaceId)]);
    }
}
