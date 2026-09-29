import { Module } from '@nestjs/common';
import { TemplateController } from './template.controller';
import { TemplateService } from './template.service';
import { TemplateAdminService } from './template.admin.service';
import { TemplateRepository } from './template.repository';

@Module({
    controllers: [TemplateController],
    providers:   [TemplateService, TemplateAdminService, TemplateRepository],
})
export class TemplateModule { }
