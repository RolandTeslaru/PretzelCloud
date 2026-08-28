import { AsyncLocalStorage } from 'node:async_hooks';
import { ConflictException, InternalServerErrorException } from '@nestjs/common';
import { Workspace } from '@pretzel-cloud/shared/domain';
import type { LockService } from '@/services/Locking/lock.service';

export const OPERATION_NAMESPACE = 'workspace-operation';

/**
 * What this async chain already holds. An operation that calls another on the
 * same workspace would otherwise be refused by its own outer hold — the two
 * take the lock on different connections, so Postgres sees two sessions.
 */
const held = new AsyncLocalStorage<Set<Workspace.Id>>();

type Locking = { lockService: LockService };

/** The argument is the workspace or its id; routes are given one, services the other. */
function getWorkspaceIdFromArgument(argument: unknown): Workspace.Id | null {
    const direct = Workspace.Id.safeParse(argument);

    if (direct.success)
        return direct.data;

    const nested = Workspace.Id.safeParse((argument as { id?: unknown } | null)?.id);

    return nested.success ? nested.data : null;
}

/**
 * One operation at a time per workspace, across every control plane instance.
 *
 * The workspace is read from the argument at `index`, and the class is expected
 * to hold a `lockService`. Both are checked at the call rather than declared,
 * so a method decorated on the wrong shape fails the first time it runs.
 */
export function Operation(index = 0): MethodDecorator {
    return (_target, key, descriptor: PropertyDescriptor) => {
        const original = descriptor.value as (...args: unknown[]) => Promise<unknown>;

        descriptor.value = async function (this: Locking, ...args: unknown[]) {
            const workspaceId = getWorkspaceIdFromArgument(args[index]);

            if (!workspaceId)
                throw new InternalServerErrorException(`${String(key)} is locked on argument ${index}, which names no workspace`);

            if (!this.lockService)
                throw new InternalServerErrorException(`${String(key)} is locked but ${this.constructor.name} has no lockService`);

            const outer = held.getStore();

            // Already this chain's: the outer hold is what serialises it.
            if (outer?.has(workspaceId))
                return original.apply(this, args);

            const inner = new Set(outer ?? []);

            inner.add(workspaceId);

            // Wrapped, so a method that legitimately returns null is not read as
            // the lock having been refused.
            const outcome = await this.lockService.withDurableLock(OPERATION_NAMESPACE, workspaceId, async () =>
                ({ value: await held.run(inner, () => original.apply(this, args)) }));

            if (!outcome)
                throw new ConflictException('This workspace is already changing');

            return outcome.value;
        };
    };
}

/**
 * Refuses a request for a workspace something else is already changing.
 *
 * Only an answer for the moment it asks — the operation itself takes the lock,
 * and that is what serialises them. This exists so the common refusal reaches
 * the browser as a 409 rather than a log line: the routes below hand the work
 * off and answer 202, so anything thrown after that is unreportable.
 */
export function RefuseIfBusy(index = 0): MethodDecorator {
    return (_target, key, descriptor: PropertyDescriptor) => {
        const original = descriptor.value as (...args: unknown[]) => Promise<unknown>;

        descriptor.value = async function (this: Locking, ...args: unknown[]) {
            const workspaceId = getWorkspaceIdFromArgument(args[index]);

            if (!workspaceId)
                throw new InternalServerErrorException(`${String(key)} reads argument ${index} as a workspace, and it names none`);

            if (!this.lockService)
                throw new InternalServerErrorException(`${String(key)} checks for a busy workspace but ${this.constructor.name} has no lockService`);

            if (await this.lockService.isDurablyLocked(OPERATION_NAMESPACE, workspaceId))
                throw new ConflictException('This workspace is already changing');

            return original.apply(this, args);
        };
    };
}
