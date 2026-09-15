import { NotFoundException } from '@nestjs/common';
import { Principal } from './identity/principal';
import { AdminRepository } from './admin.repository';

export async function requireAdmin(adminRepository: AdminRepository, principal: Principal | undefined): Promise<Principal.AdminUser> {
    if (principal?.type !== 'user')
        throw new NotFoundException();

    const isAdmin = await adminRepository.isAdmin(Principal.SELF, principal.userId);

    if (!isAdmin)
        throw new NotFoundException();

    return Principal.AdminUser.Schema.parse(principal);
}
