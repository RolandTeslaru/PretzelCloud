import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { Workspace } from '@pretzel-cloud/shared/domain';
import { PermissionService } from '@/services/Permission/permission.service';

export const CLOUD_TOKEN_HEADER = 'x-pretzel-cloud-token';

/**
 * A silo calling the cloud. Not a user and not the router: the token is per
 * workspace, held only by the role that answers HTTP, and only ever proves the
 * workspace named in the path.
 */
@Injectable()
export class SiloAuthGuard implements CanActivate {

    constructor(private readonly permissions: PermissionService) {}

    public async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<Request>();

        const given = request.headers[CLOUD_TOKEN_HEADER];

        if (typeof given !== 'string' || given.length === 0)
            throw new UnauthorizedException('Missing cloud token');

        const workspaceId = Workspace.Id.safeParse(request.params.workspaceId);

        if (!workspaceId.success)
            throw new UnauthorizedException('Invalid workspace');

        if (!await this.permissions.doesWorkspaceMatchCloudToken(workspaceId.data, given))
            throw new UnauthorizedException('Invalid cloud token');

        request.principal = { type: 'silo', workspaceId: workspaceId.data };

        return true;
    }
}
