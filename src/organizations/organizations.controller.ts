import { Controller, Body, Patch, Get, UseGuards } from '@nestjs/common';
import { OrganizationsService } from './organizations.service.js';
import { UpdateCompanyInfoDto } from './dto/update-company-info.dto.js';
import { ActiveOrgId } from '../auth/decorators.js';
import { OrganizationGuard } from '../auth/organization.guard.js';

@Controller('organizations')
@UseGuards(OrganizationGuard)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get('company-info')
  getCompanyInfo(@ActiveOrgId() orgId: string) {
    return this.organizationsService.getCompanyInfo(orgId);
  }


  @Patch('company-info')
  updateCompanyInfo(
    @ActiveOrgId() orgId: string,
    @Body() updateCompanyInfoDto: UpdateCompanyInfoDto,
  ) {
    return this.organizationsService.updateCompanyInfo(orgId, updateCompanyInfoDto);
  }
}

