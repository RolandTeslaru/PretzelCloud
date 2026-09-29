import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** Limits per visitor: the API is reached through the router on loopback, so the edge's header names the client. */
@Injectable()
export class ClientThrottlerGuard extends ThrottlerGuard {

    protected override async getTracker(req: Record<string, any>): Promise<string> {
        const flyClientIp = req.headers?.['fly-client-ip'];

        if (typeof flyClientIp === 'string' && flyClientIp.length > 0)
            return flyClientIp;

        return req.ip;
    }
}
