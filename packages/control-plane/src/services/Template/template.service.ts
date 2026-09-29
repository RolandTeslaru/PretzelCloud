import { Injectable } from '@nestjs/common';
import { Listing, Template } from '@pretzel-cloud/shared/domain';
import { Principal } from '@/auth/identity/principal';
import { TemplateRepository } from './template.repository';

// Starting points for a new workflow, backed by ordinary listings.
@Injectable()
export class TemplateService {

    constructor(private readonly templateRepository: TemplateRepository) {}


    public async getAll(release: Listing.Release): Promise<Record<Listing.Id, Template>> {
        return this.templateRepository.getAll(Principal.SELF, release);
    }
}
