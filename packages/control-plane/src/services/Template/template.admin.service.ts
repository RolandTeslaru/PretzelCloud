import { Injectable, NotFoundException } from '@nestjs/common';
import { Listing, Template } from '@pretzel-cloud/shared/domain';
import { Principal } from '@/auth/identity/principal';
import { TemplateRepository } from './template.repository';

// Picks which listings are offered as templates, and under which categories.
@Injectable()
export class TemplateAdminService {

    constructor(private readonly templateRepository: TemplateRepository) {}

    public async set(adminUser: Principal.AdminUser, listingId: Listing.Id, request: Template.API.Set.Request): Promise<void> {
        const categoryIds = [...new Set(request.categoryIds)];

        const found = await this.templateRepository.set(Principal.SELF, listingId, { ...request, categoryIds });

        if (!found)
            throw new NotFoundException('No such listing');
    }

    public async remove(adminUser: Principal.AdminUser, listingId: Listing.Id): Promise<void> {
        await this.templateRepository.remove(Principal.SELF, listingId);
    }
}
