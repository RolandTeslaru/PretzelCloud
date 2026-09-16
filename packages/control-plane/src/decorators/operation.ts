import { AsyncLocalStorage } from 'node:async_hooks';
import { ConflictException, InternalServerErrorException } from '@nestjs/common';
import { User, Workspace } from '@pretzel-cloud/shared/domain';
import type { LockService } from '@/services/Locking/lock.service';

/**
 * What this async chain already holds, as `namespace:id`. An operation that
 * calls another on the same subject would otherwise be refused by its own outer
 * hold — the two take the lock on different connections, so Postgres sees two sessions.
 */
const held = new AsyncLocalStorage<Set<string>>();

type Locking = { lockService: LockService };

/** The argument is the workspace or its id; routes are given one, services the other. */
function getWorkspaceIdFromArgument(argument: unknown): string | null {
    const direct = Workspace.Id.safeParse(argument);

    if (direct.success)
        return direct.data;

    const nested = Workspace.Id.safeParse((argument as { id?: unknown } | null)?.id);

    return nested.success ? nested.data : null;
}

/** The argument is the user's id or a principal acting as them. */
function getUserIdFromArgument(argument: unknown): string | null {
    const direct = User.Id.safeParse(argument);

    if (direct.success)
        return direct.data;

    const nested = User.Id.safeParse((argument as { userId?: unknown } | null)?.userId);

    return nested.success ? nested.data : null;
}

/** What an operation can lock: where its lock lives, how to find its id, and what a refusal says. */
const SUBJECTS = {
    workspace: { namespace: 'workspace-operation', getId: getWorkspaceIdFromArgument, busy: 'This workspace is already changing' },
    account:   { namespace: 'user-account',        getId: getUserIdFromArgument,      busy: 'This account is already changing. Please retry.' },
} as const;

export type OperationSubject = keyof typeof SUBJECTS;

/**
 * One operation at a time per subject, across every control plane instance.
 *
 * The subject's id is read from the argument at `index`, and the class is expected
 * to hold a `lockService`. Both are checked at the call rather than declared,
 * so a method decorated on the wrong shape fails the first time it runs.
 */
export function Operation(subject: OperationSubject, index = 0): MethodDecorator {
    const { namespace, getId, busy } = SUBJECTS[subject];

    return (_target, key, descriptor: PropertyDescriptor) => {
        const original = descriptor.value as (...args: unknown[]) => Promise<unknown>;

        descriptor.value = async function (this: Locking, ...args: unknown[]) {
            const id = getId(args[index]);

            if (!id)
                throw new InternalServerErrorException(`${String(key)} is locked on argument ${index}, which names no ${subject}`);

            if (!this.lockService)
                throw new InternalServerErrorException(`${String(key)} is locked but ${this.constructor.name} has no lockService`);

            const heldKey = `${namespace}:${id}`;

            const outer = held.getStore();

            // Already this chain's: the outer hold is what serialises it.
            if (outer?.has(heldKey))
                return original.apply(this, args);

            const inner = new Set(outer ?? []);

            inner.add(heldKey);

            // Wrapped, so a method that legitimately returns null is not read as
            // the lock having been refused.
            const outcome = await this.lockService.withDurableLock(namespace, id, async () =>
                ({ value: await held.run(inner, () => original.apply(this, args)) }));

            if (!outcome)
                throw new ConflictException(busy);

            return outcome.value;
        };
    };
}

/**
 * Refuses a request for a subject something else is already changing.
 *
 * Only an answer for the moment it asks — the operation itself takes the lock,
 * and that is what serialises them. This exists so the common refusal reaches
 * the browser as a 409 rather than a log line: the routes below hand the work
 * off and answer 202, so anything thrown after that is unreportable.
 */
export function RefuseIfBusy(subject: OperationSubject, index = 0): MethodDecorator {
    const { namespace, getId, busy } = SUBJECTS[subject];

    return (_target, key, descriptor: PropertyDescriptor) => {
        const original = descriptor.value as (...args: unknown[]) => Promise<unknown>;

        descriptor.value = async function (this: Locking, ...args: unknown[]) {
            const id = getId(args[index]);

            if (!id)
                throw new InternalServerErrorException(`${String(key)} reads argument ${index} as a ${subject}, and it names none`);

            if (!this.lockService)
                throw new InternalServerErrorException(`${String(key)} checks for a busy ${subject} but ${this.constructor.name} has no lockService`);

            if (await this.lockService.isDurablyLocked(namespace, id))
                throw new ConflictException(busy);

            return original.apply(this, args);
        };
    };
}
