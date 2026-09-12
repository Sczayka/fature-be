import { Controller, Body, Patch, UseGuards } from '@nestjs/common';
import { OrganizationsService } from './organizations.service.js';
import { UpdateCompanyInfoDto } from './dto/update-company-info.dto.js';
import { ActiveOrgId } from '../auth/decorators.js';
import { OrganizationGuard } from '../auth/organization.guard.js';

@Controller('organizations')
@UseGuards(OrganizationGuard)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Patch('company-info')
  updateCompanyInfo(
    @ActiveOrgId() orgId: string,
    @Body() updateCompanyInfoDto: UpdateCompanyInfoDto,
  ) {
    return this.organizationsService.updateCompanyInfo(orgId, updateCompanyInfoDto);
  }
}

