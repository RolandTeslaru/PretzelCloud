import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { connect } from 'node:net';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { Principal } from '@/auth/identity/principal';
import { MachineService } from '../Machine/machine.service';
import { MachineRepository } from '../Machine/machine.repository';

// How long a woken machine is given to open its port, and how often it is asked.
const WAKE_TIMEOUT_MS = 60_000;
const WAKE_PROBE_MS   = 250;
const CONNECT_TIMEOUT_MS = 1_000;

const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

// One TCP connect, then hang up. True if the port accepted.
const canConnect = (address: URL): Promise<boolean> =>
    new Promise((resolve) => {
        const port = Number(address.port);

        const socket = connect({ host: address.hostname, port });

        socket.setTimeout(CONNECT_TIMEOUT_MS);

        socket.once('connect', () => {
            socket.destroy();

            resolve(true);
        });

        socket.once('timeout', () => {
            socket.destroy();

            resolve(false);
        });

        socket.once('error', () => {
            resolve(false);
        });
    });

/** Drives a workspace's machines up and down; the topology they form is Hardware's. */
@Injectable()
export class HardwareLifecycleService {

    private readonly logger = new Logger(HardwareLifecycleService.name);

    constructor(
        private readonly machineService:    MachineService,
        private readonly machineRepository: MachineRepository,
    ) {}




    /** Blocks until every machine in the hardware reports serving, then records its state. */
    async awaitHealthy(hardware: Fleet.Hardware): Promise<void> {
        if (hardware.machines.length === 0)
            throw new Error(`No machines to await for ${hardware.workspaceId}`);

        await Promise.all(hardware.machines.map(async (machine) => {
            await this.machineService.awaitHealthy(machine);

            machine.state = await this.machineService.refreshState(machine);
        }));
    }




    /** Blocks until the machine serving workspace traffic is healthy, then records its state. */
    async awaitBackendHealthy(workspaceId: Workspace.Id): Promise<void> {
        const backend = await this.getBackend(workspaceId);

        await this.machineService.awaitHealthy(backend);

        await this.machineService.refreshState(backend);
    }




    /** Starts the machine that answers HTTP and waits for its port; null when there is no backend to start. */
    async wakeBackend(workspaceId: Workspace.Id): Promise<URL | null> {
        // Absence is an answer here, not an error: the caller rebuilds a reclaimed workspace.
        const backend = await this.machineRepository.getByRole(Principal.SELF, workspaceId, ['backend', 'combined']);

        if (!backend)
            return null;

        const startedAt = Date.now();

        await this.machineService.wake(backend);

        const startReturnedAt = Date.now();

        const address = await this.awaitReachable(backend);

        const portOpenAt = Date.now();

        this.logger.log(`Woke ${workspaceId} from ${backend.state} in ${portOpenAt - startedAt}ms (start call ${startReturnedAt - startedAt}ms, port open ${portOpenAt - startReturnedAt}ms)`);

        return address;
    }




    // The port opening is the health check: it is exactly what the forward is about to do.
    private async awaitReachable(machine: Fleet.Machine): Promise<URL> {
        const deadline = Date.now() + WAKE_TIMEOUT_MS;

        let address: URL | null = null;

        while (Date.now() < deadline) {
            if (!address)
                address = await this.machineService.address(machine);

            if (address && await canConnect(address))
                return address;

            await sleep(WAKE_PROBE_MS);
        }

        throw new Error(`Machine ${machine.resourceId} did not open its port within ${WAKE_TIMEOUT_MS}ms`);
    }




    /** Starts the machine that answers HTTP, without waiting for its port. */
    async startBackend(workspaceId: Workspace.Id): Promise<void> {
        const backend = await this.getBackend(workspaceId);

        await this.machineService.wake(backend);
    }




    /** The machine that answers HTTP, or a not-found — a workspace without one has been reclaimed. */
    private async getBackend(workspaceId: Workspace.Id): Promise<Fleet.Machine> {
        const backend = await this.machineRepository.getByRole(Principal.SELF, workspaceId, ['backend', 'combined']);

        if (!backend)
            throw new NotFoundException(`${workspaceId} has no backend`);

        return backend;
    }




    /** One of the workspace's workers, or a not-found — one workspace cannot name another's machine. */
    private async getWorker(workspaceId: Workspace.Id, workerId: Fleet.Machine.Id): Promise<Fleet.Machine> {
        const worker = await this.machineRepository.getWorkerById(Principal.SELF, workspaceId, workerId);

        if (!worker)
            throw new NotFoundException(`${workspaceId} has no worker ${workerId}`);

        return worker;
    }




    /** Starts one queue drainer — a sleeping worker is not watching Redis. */
    async wakeWorker(workspaceId: Workspace.Id, workerId: Fleet.Machine.Id, options?: Fleet.Machine.CommandOptions): Promise<void> {
        const worker = await this.getWorker(workspaceId, workerId);

        await this.machineService.wake(worker, options);
    }




    /** Suspends one queue drainer, leaving the backend and the other workers as they are. */
    async sleepWorker(workspaceId: Workspace.Id, workerId: Fleet.Machine.Id, options?: Fleet.Machine.CommandOptions): Promise<void> {
        const worker = await this.getWorker(workspaceId, workerId);

        // The record can lag the machine, so the driver is asked before deciding.
        const state = await this.machineService.refreshState(worker);

        if (state === 'running')
            await this.machineService.suspend(worker, options);
    }




    /** Nothing left running — worker included. */
    stopAll(workspaceId: Workspace.Id): Promise<void> {
        return this.fanOut(workspaceId, 'stop');
    }




    /** Freezes what can be frozen; a worker exceeds the snapshot ceiling. */
    suspendBackend(workspaceId: Workspace.Id): Promise<void> {
        return this.fanOut(workspaceId, 'suspend');
    }




    /** Everything down, then answerable again. The worker returns on demand. */
    async restartAll(workspaceId: Workspace.Id): Promise<void> {
        await this.stopAll(workspaceId);
        await this.startBackend(workspaceId);
    }




    /** One action across every machine it applies to; inapplicable ones are skipped, not failed. */
    private async fanOut(workspaceId: Workspace.Id, action: Fleet.Machine.LifecycleAction): Promise<void> {
        // Stopping the backend first would strand the worker, whose shutdown needs the queue.
        const machines = Fleet.Machine.inLifecycleOrder(action, await this.machineService.getAll(workspaceId));

        for (const machine of machines) {
            if (!Fleet.Machine.canApply(action, machine))
                continue;

            switch (action) {
                case 'start':   await this.machineService.start(machine);   break;
                case 'stop':    await this.machineService.stop(machine);    break;
                case 'suspend': await this.machineService.suspend(machine); break;
                case 'resume':  await this.machineService.resume(machine);  break;
                case 'restart': await this.machineService.restart(machine); break;
            }
        }
    }
}
