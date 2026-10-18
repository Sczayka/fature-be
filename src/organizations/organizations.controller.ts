import {
  Controller,
  Body,
  Patch,
  Get,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { OrganizationsService } from './organizations.service.js';
import { UpdateCompanyInfoDto } from './dto/update-company-info.dto.js';
import { ActiveOrgId } from '../auth/decorators.js';
import { OrganizationGuard } from '../auth/organization.guard.js';
import { PayloadValidationPipe } from '../common/pipes/payload-validation.pipe.js';

// A validação descarta campos fora do DTO: o body vai direto para o update da organização
@Controller('organizations')
@UseGuards(OrganizationGuard)
@UsePipes(PayloadValidationPipe)
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

  @Get('gateway-status')
  getGatewayStatus(@ActiveOrgId() orgId: string) {
    return this.organizationsService.getGatewayStatus(orgId);
  }
}

