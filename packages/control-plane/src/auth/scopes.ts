import { SetMetadata } from '@nestjs/common';
import { Workspace } from '@pretzel-cloud/shared/domain';

/** What a resolved scope holds, per name. */
export type Scopes = {
    workspace: Workspace;
};

export type ScopeName = keyof Scopes;
export type Scope<K extends ScopeName> = Scopes[K];

export const SCOPE = 'pretzel.scope';
export const REQUIRE_OWNER = 'pretzel.require-owner';

/** Declares which resource this route acts on. ScopedGuard resolves it. */
export const Scoped = (name: ScopeName) => SetMetadata(SCOPE, name);

/**
 * The account owner, checked against the resolved scope.
 *
 * Deliberately not a role: renaming, rehosting and destroying a workspace are
 * account-level, and the roles that govern what happens *inside* a workspace
 * live in its own database and have no say here.
 */
export const RequireOwner = () => SetMetadata(REQUIRE_OWNER, true);
