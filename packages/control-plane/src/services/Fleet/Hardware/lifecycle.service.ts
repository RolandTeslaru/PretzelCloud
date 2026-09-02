import { Injectable, Logger } from '@nestjs/common';
import { connect } from 'node:net';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { Principal } from '@/auth/identity/principal';
import { MachineService } from '../Machine/machine.service';
import { MachineRepository } from '../Machine/machine.repository';
import { HardwareStateService } from './state.service';
import { HardwareStatisticsSampler } from './statistics.sampler';

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
        private readonly stateService:      HardwareStateService,
        private readonly statisticsSampler: HardwareStatisticsSampler,
    ) {}




    /** Blocks until every recorded machine reports serving. */
    async awaitHealthy(workspaceId: Workspace.Id): Promise<void> {
        const machines = await this.machineService.getAll(workspaceId);

        if (machines.length === 0)
            throw new Error(`No machines to await for ${workspaceId}`);

        await Promise.all(machines.map((machine) => this.machineService.awaitHealthy(machine)));

        // Nothing else runs after a first provision, and the idle sweep skips a machine reading `creating`.
        await this.stateService.refreshAll(workspaceId);
    }




    /** Starts the machine that answers HTTP and waits for its port; null when there is no backend to start. */
    async wakeBackend(workspaceId: Workspace.Id): Promise<URL | null> {
        const backend = await this.machineService.getByRole(workspaceId, ['backend', 'combined']);

        if (!backend)
            return null;

        const startedAt = Date.now();

        if (backend.state === 'suspended')
            await this.machineService.resume(backend);
        else if (backend.state === 'stopped')
            await this.machineService.start(backend);

        const startReturnedAt = Date.now();

        const address = await this.awaitReachable(backend);

        const portOpenAt = Date.now();

        this.logger.log(`Woke ${workspaceId} from ${backend.state} in ${portOpenAt - startedAt}ms (start call ${startReturnedAt - startedAt}ms, port open ${portOpenAt - startReturnedAt}ms)`);

        // The idle sweep reads this; a machine left reading `suspended` is never put back to sleep.
        await this.machineRepository.setState(Principal.SELF, backend.id, 'running');

        // The only transition that writes a state without going through `refreshAll`.
        this.statisticsSampler.invalidate(workspaceId);

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
        const backend = await this.machineService.getByRole(workspaceId, ['backend', 'combined']);

        // A suspended machine resumes, a stopped one starts.
        if (backend?.state === 'suspended')
            await this.machineService.resume(backend);
        else if (backend?.state === 'stopped')
            await this.machineService.start(backend);

        await this.stateService.refreshAll(workspaceId);
    }




    /** Starts the queue drainer before enqueueing — a sleeping worker is not watching Redis. */
    async startWorker(workspaceId: Workspace.Id): Promise<void> {
        const worker = await this.machineService.getByRole(workspaceId, ['worker']);

        if (!worker) {
            // A combined machine is its own worker; anything else means the fleet has lost one.
            const combined = await this.machineService.getByRole(workspaceId, ['combined']);

            if (combined)
                return;

            throw new Error(`${workspaceId} has no worker machine to start`);
        }

        // The record can lag the machine, so the driver is asked before deciding.
        const state = await this.machineService.refreshState(worker);

        if (state === 'suspended')
            await this.machineService.resume(worker);
        else if (state === 'stopped')
            await this.machineService.start(worker);

        await this.stateService.refreshAll(workspaceId);
    }




    /** Stops the queue drainer, leaving the backend answering. A combined machine is left alone. */
    async stopWorker(workspaceId: Workspace.Id): Promise<void> {
        const worker = await this.machineService.getByRole(workspaceId, ['worker']);

        if (!worker)
            return;

        // The record can lag the machine, so the driver is asked before deciding.
        const state = await this.machineService.refreshState(worker);

        if (Fleet.Machine.canApply('stop', { role: worker.role, state }))
            await this.machineService.stop(worker);

        await this.stateService.refreshAll(workspaceId);
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

            await this.dispatch(machine, action);
        }

        await this.stateService.refreshAll(workspaceId);
    }




    private dispatch(machine: Fleet.Machine, action: Fleet.Machine.LifecycleAction): Promise<void> {
        switch (action) {
            case 'start':   return this.machineService.start(machine);
            case 'stop':    return this.machineService.stop(machine);
            case 'suspend': return this.machineService.suspend(machine);
            case 'resume':  return this.machineService.resume(machine);
            case 'restart': return this.machineService.restart(machine);
        }
    }
}
