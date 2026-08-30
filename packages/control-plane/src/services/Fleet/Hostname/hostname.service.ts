import { Injectable } from '@nestjs/common';
import { Fleet, Workspace } from '@pretzel-cloud/shared/domain';
import { Principal } from '@/auth/identity/principal';
import { HostnameRepository } from './hostname.repository';

@Injectable()
export class HostnameService {

    constructor(private readonly hostnameRepository: HostnameRepository) {}

    /** The pair every workspace answers at, derived from its id. Never removed. */
    public async registerCanonical(workspaceId: Workspace.Id): Promise<void> {
        const canonical = Workspace.Subdomain.canonical(workspaceId);

        await this.hostnameRepository.register(Principal.SELF, workspaceId, Fleet.Hostname.Host.createAll(canonical));
    }

    /** Replaces the custom pair, leaving the canonical one alone. Null clears it. */
    public async setCustom(workspaceId: Workspace.Id, subdomain: Workspace.Subdomain | null): Promise<void> {
        const canonical = Workspace.Subdomain.canonical(workspaceId);
        const keep = Fleet.Hostname.Host.createAll(canonical).map((entry) => entry.host);
        const entries = subdomain ? Fleet.Hostname.Host.createAll(subdomain) : [];

        await this.hostnameRepository.replaceExcept(Principal.SELF, workspaceId, keep, entries);
    }

    public async delete(workspaceId: Workspace.Id): Promise<void> {
        await this.hostnameRepository.deleteFor(Principal.SELF, workspaceId);
    }
}
