import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    HttpException,
    InternalServerErrorException,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { NoResultError } from 'kysely';
import type { ZodType } from 'zod';

export type DatabaseRole = 'user' | 'silo' | 'service';

const ROLE_SYMBOLS = [
    Symbol.for('pretzel.cloud.portal.role'),
    Symbol.for('pretzel.cloud.fleet.role'),
];

const getRoleFromHandle = (handle: unknown): DatabaseRole | undefined => {
    for (const symbol of ROLE_SYMBOLS) {
        const role = (handle as Record<symbol, DatabaseRole> | null | undefined)?.[symbol];

        if (role)
            return role;
    }

    return undefined;
};

const DECLARED = Symbol.for('pretzel.cloud.db.declared');

type Registry = Record<string, DatabaseRole[]>;

function getRegistry(prototype: object): Registry {
    if (!Object.prototype.hasOwnProperty.call(prototype, DECLARED))
        Object.defineProperty(prototype, DECLARED, { value: {}, enumerable: false, configurable: true });

    return (prototype as Record<symbol, Registry>)[DECLARED];
}

/** Declared at compile time by the handle's type, checked again from its tag at runtime. */
export function AllowedDatabaseRoles(...roles: DatabaseRole[]): MethodDecorator {
    return (target, key, descriptor: PropertyDescriptor) => {
        getRegistry(target as object)[String(key)] = roles;

        const original = descriptor.value as (...args: unknown[]) => unknown;

        descriptor.value = function (this: unknown, ...args: unknown[]) {
            const role = getRoleFromHandle(args[0]);

            if (!role)
                throw new InternalServerErrorException(`${String(key)} received an untagged handle — not from asUser/asService`);

            if (!roles.includes(role))
                throw new InternalServerErrorException(`${String(key)} may not run as '${role}' (declares: ${roles.join(', ')})`);

            return original.apply(this, args);
        };

        return descriptor;
    };
}

// Raw pg errors carry table names, constraint names and rejected values, so none
// of them reach a client.
const BY_SQLSTATE: Record<string, (detail: string) => HttpException> = {
    '42501': () => new ForbiddenException('Not allowed'),
    '23505': () => new ConflictException('Already exists'),
    '23503': () => new NotFoundException('Not found'),
    '23502': () => new BadRequestException('Missing a required value'),
    '22P02': () => new BadRequestException('Malformed value'),
};

const logger = new Logger('Database');

function catchDatabaseErrors(fn: (...args: unknown[]) => unknown, operation: string) {
    return async function (this: unknown, ...args: unknown[]) {
        try {
            return await fn.apply(this, args);
        }
        catch (error) {
            if (error instanceof HttpException)
                throw error;

            // Under an RLS handle, nothing found means not visible to this
            // caller. It carries no SQLSTATE, so it would otherwise be a 500.
            if (error instanceof NoResultError) {
                logger.debug(`${operation}: no result`);

                throw new NotFoundException('Not found');
            }

            const sqlstate = (error as { code?: string }).code ?? '';
            const detail   = error instanceof Error ? error.message : String(error);

            logger.error(`${operation} [${sqlstate}]: ${detail}`);

            throw (BY_SQLSTATE[sqlstate] ?? (() => new InternalServerErrorException()))(detail);
        }
    };
}

/**
 * Every method declares its roles or the class throws at import, and every
 * method's driver errors become HTTP exceptions. `_` prefixed methods are exempt.
 */
export function DatabaseClass<T extends new (...args: never[]) => object>(ctor: T): T {
    const prototype = ctor.prototype as Record<string, unknown>;
    const declared  = getRegistry(ctor.prototype);

    const methods = Object.getOwnPropertyNames(prototype)
        .filter((name) => name !== 'constructor' && !name.startsWith('_'))
        .filter((name) => typeof prototype[name] === 'function');

    const missing = methods.filter((name) => !(name in declared));

    if (missing.length)
        throw new Error(`${ctor.name}: methods missing @AllowedDatabaseRoles — ${missing.join(', ')}`);

    for (const name of methods)
        prototype[name] = catchDatabaseErrors(prototype[name] as (...args: unknown[]) => unknown, `${ctor.name}.${name}`);

    return ctor;
}

export function ZodReturn<T>(schema: ZodType<T>): MethodDecorator {
    return (_target, _key, descriptor: PropertyDescriptor) => {
        const original = descriptor.value;

        descriptor.value = async function (this: unknown, ...args: unknown[]) {
            return schema.parse(await original.apply(this, args));
        };

        return descriptor;
    };
}
