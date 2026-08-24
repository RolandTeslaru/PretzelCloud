// Param decorators whose values only ever come from a guard that vouched for them.
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Scope, ScopeName } from './scopes';
import { ScopedRequest } from './guards/scoped.guard';

/**
 * Reads a resolved scope off the request — never `request.params`. A resource is
 * here only because ScopedGuard vouched for it, so a route that declares the
 * param without `@Scoped(...)` fails on its first request instead of quietly
 * serving unauthorized data.
 */
const readScope = <K extends ScopeName>(context: ExecutionContext, name: K): Scope<K> => {
    const { scopes } = context.switchToHttp().getRequest<ScopedRequest>();

    const scope = scopes?.[name];

    if (!scope)
        throw new Error(`Scope '${name}' requested without @Scoped('${name}') on the route`);

    return scope as Scope<K>;
};

export const WorkspaceScope = createParamDecorator(
    (_: unknown, context: ExecutionContext) => readScope(context, 'workspace'),
);

/** The workspace id from whichever guard vouched for it; never `request.params`. */
export const WorkspaceIdParam = createParamDecorator(
    (_: unknown, context: ExecutionContext) => {
        const request = context.switchToHttp().getRequest<ScopedRequest>();

        const principal = request.principal;
        const id = request.scopes?.workspace?.id
            ?? (principal?.type === 'silo' ? principal.workspaceId : undefined);

        if (!id)
            throw new Error(`WorkspaceIdParam used without @Scoped('workspace') or SiloAuthGuard on the route`);

        return id;
    },
);
