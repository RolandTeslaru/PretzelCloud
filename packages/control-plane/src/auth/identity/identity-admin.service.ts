import { Injectable, Logger } from '@nestjs/common';
import { SignJWT } from 'jose';
import { User } from '@pretzel-cloud/shared/domain';
import { requireEnv } from '@/db/table';

// The admin surface answers to a token signed with the same secret it verifies with.
const ADMIN_ROLE = 'service_role';
const ALGORITHM  = 'HS256';
const TOKEN_TTL  = 60;

@Injectable()
export class IdentityAdminService {

    private readonly logger = new Logger(IdentityAdminService.name);

    /** Removes the credential only; the profile row is separate. */
    public async deleteUser(userId: User.Id): Promise<void> {
        const response = await this.call(`/admin/users/${userId}`, 'DELETE');

        // Already gone is the outcome asked for.
        if (response.status === 404)
            return;

        if (!response.ok)
            throw new Error(`Issuer refused to delete ${userId}: ${response.status} ${await response.text()}`);

        this.logger.log(`deleted issuer account ${userId}`);
    }

    private async call(path: string, method: string): Promise<Response> {
        return fetch(`${requireEnv('AUTH_ADMIN_URL')}${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${await this.getAdminToken()}`,
                'Content-Type': 'application/json',
            },
        });
    }

    // Minted per call: cheaper than tracking an expiry, worthless in a minute.
    private async getAdminToken(): Promise<string> {
        return new SignJWT({ role: ADMIN_ROLE })
            .setProtectedHeader({ alg: ALGORITHM })
            .setIssuedAt()
            .setExpirationTime(`${TOKEN_TTL}s`)
            .sign(new TextEncoder().encode(requireEnv('AUTH_JWT_SECRET')));
    }
}
