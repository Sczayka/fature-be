import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  UsePipes,
  Query,
} from '@nestjs/common';
import { InvoiceDraftsService } from './invoice-drafts.service.js';
import { CreateInvoiceDraftDto } from './dto/create-invoice-draft.dto.js';
import { UpdateInvoiceDraftDto } from './dto/update-invoice-draft.dto.js';
import { OrganizationGuard } from '../../auth/organization.guard.js';
import { ActiveGatewayGuard } from '../../auth/active-gateway.guard.js';
import { ActiveOrgId } from '../../auth/decorators.js';
import { PayloadValidationPipe } from '../../common/pipes/payload-validation.pipe.js';

@UseGuards(OrganizationGuard)
@UsePipes(PayloadValidationPipe)
@Controller('invoices/drafts')
export class InvoiceDraftsController {
  constructor(private readonly invoiceDraftsService: InvoiceDraftsService) {}

  @Post()
  create(@ActiveOrgId() orgId: string, @Body() dto: CreateInvoiceDraftDto) {
    return this.invoiceDraftsService.create(orgId, dto);
  }

  @Get()
  findAll(
    @ActiveOrgId() orgId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('createdAt') createdAt?: string,
  ) {
    const pageNumber = page ? parseInt(page, 10) : 1;
    const limitNumber = limit ? parseInt(limit, 10) : 10;
    return this.invoiceDraftsService.findAll(orgId, pageNumber, limitNumber, {
      createdAt,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string, @ActiveOrgId() orgId: string) {
    return this.invoiceDraftsService.findOne(id, orgId);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @ActiveOrgId() orgId: string,
    @Body() dto: UpdateInvoiceDraftDto,
  ) {
    return this.invoiceDraftsService.update(id, orgId, dto);
  }

  @Post(':id/convert')
  @UseGuards(ActiveGatewayGuard)
  convert(@Param('id') id: string, @ActiveOrgId() orgId: string) {
    return this.invoiceDraftsService.convertToInvoice(id, orgId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @ActiveOrgId() orgId: string) {
    return this.invoiceDraftsService.remove(id, orgId);
  }
}
