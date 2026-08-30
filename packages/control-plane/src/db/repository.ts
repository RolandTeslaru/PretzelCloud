import { AsyncLocalStorage } from 'node:async_hooks';
import { InternalServerErrorException } from '@nestjs/common';
import { Principal } from '@/auth/identity/principal';
import { catchDatabaseErrors } from '@/decorators/database';

/**
 * The repository pattern: a repository method takes the acting principal as its
 * first argument, and @Transactional opens the transaction, sets the database
 * role from the principal, and hands the method its handle via `this.trx`.
 * Services never see a transaction, so a transaction never outlives one
 * repository method.
 *
 * Unlike Spring's @Transactional, nothing propagates: a decorated method
 * calling another decorated method throws. Composition happens inside one
 * repository method, using `_`-prefixed undecorated helpers.
 */

type Kind = Principal['type'];

type PrincipalOf<K extends Kind> = Extract<Principal, { type: K }>;

/** The asUser/asSilo/asService surface a database module offers. */
export interface DatabaseModule {
    asService(reason: string, fn: never): Promise<unknown>;
    asUser?(principal: never, fn: never): Promise<unknown>;
    asSilo?(principal: never, fn: never): Promise<unknown>;
}

type MemberTrx<DB, K extends string> =
    DB extends Record<K, (first: never, fn: (trx: infer T) => Promise<unknown>) => Promise<unknown>> ? T : never;

/** Every transaction shape the module can open, so `this.trx` types against the right tables. */
export type TransactionOf<DB extends DatabaseModule> =
    MemberTrx<DB, 'asService'> | MemberTrx<DB, 'asUser'> | MemberTrx<DB, 'asSilo'>;

const transactionStorage = new AsyncLocalStorage<{ trx: unknown }>();

const DATABASE = Symbol.for('pretzel.cloud.repository.database');

function getDatabase(instance: object): DatabaseModule {
    const database = (instance.constructor as unknown as Record<symbol, DatabaseModule | undefined>)[DATABASE];

    if (!database)
        throw new InternalServerErrorException('@Transactional on a class that does not extend Repository(...)');

    return database;
}

/**
 * Base class factory. The argument binds the subclass to one database — the
 * decorator reads it to open transactions there, and `this.trx` types against
 * its tables.
 */
export function Repository<DB extends DatabaseModule>(database: DB) {

    abstract class RepositoryBase {

        public static readonly [DATABASE] = database;

        /** The transaction @Transactional opened for the current call. */
        protected get trx(): TransactionOf<DB> {
            const store = transactionStorage.getStore();

            if (!store)
                throw new InternalServerErrorException('No open transaction — is the method missing @Transactional?');

            return store.trx as TransactionOf<DB>;
        }
    }

    return RepositoryBase;
}

/**
 * Opens a transaction as the principal in the method's first argument, checked
 * against `accepted` at compile time and runtime. The asService audit reason is
 * the method's own qualified name. Driver errors become HTTP exceptions.
 */
export function Transactional<K extends [Kind, ...Kind[]]>(...accepted: K) {
    return function <M extends (principal: PrincipalOf<K[number]>, ...rest: never[]) => Promise<unknown>>(
        target: object,
        key: string | symbol,
        descriptor: TypedPropertyDescriptor<M>,
    ): void {
        const original = descriptor.value;

        if (!original)
            throw new Error(`@Transactional(${accepted.join(', ')}) must decorate a method`);

        const operation = `${(target.constructor as { name: string }).name}.${String(key)}`;

        const wrapped = async function (this: object, ...args: unknown[]): Promise<unknown> {
            const [principal, ...rest] = args as [Principal, ...unknown[]];

            if (!accepted.includes(principal.type))
                throw new InternalServerErrorException(`${operation} may not run as '${principal.type}' (accepts: ${accepted.join(', ')})`);

            if (transactionStorage.getStore())
                throw new InternalServerErrorException(`${operation} would nest transactions — compose inside one repository method via a _ helper`);

            const database = getDatabase(this);

            const run = (trx: never): Promise<unknown> =>
                transactionStorage.run({ trx }, () => original.apply(this, [principal, ...rest] as Parameters<M>));

            switch (principal.type) {
                case 'user': {
                    if (!database.asUser)
                        throw new InternalServerErrorException(`${operation}: this database has no user role`);

                    return database.asUser(principal as never, run as never);
                }
                case 'silo': {
                    if (!database.asSilo)
                        throw new InternalServerErrorException(`${operation}: this database has no silo role`);

                    return database.asSilo(principal as never, run as never);
                }
                case 'service':
                    return database.asService(operation, run as never);
            }
        };

        descriptor.value = catchDatabaseErrors(wrapped, operation) as unknown as M;
    };
}
