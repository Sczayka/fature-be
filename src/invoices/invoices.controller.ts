import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { InvoicesService } from './invoices.service.js';
import { CreateInvoiceDto } from './dto/create-invoice.dto.js';
import { OrganizationGuard } from '../auth/organization.guard.js';
import { ActiveOrgId } from '../auth/decorators.js';

@UseGuards(OrganizationGuard)
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  create(
    @ActiveOrgId() orgId: string,
    @Body() createInvoiceDto: CreateInvoiceDto,
  ) {
    return this.invoicesService.create(orgId, createInvoiceDto);
  }
}
