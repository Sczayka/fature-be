import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { InvoicesService } from './invoices.service.js';
import { CreateInvoiceDto } from './dto/create-invoice.dto.js';
import { OrganizationGuard } from '../auth/organization.guard.js';
import { ActiveGatewayGuard } from '../auth/active-gateway.guard.js';
import { ActiveOrgId } from '../auth/decorators.js';
import { PayloadValidationPipe } from '../common/pipes/payload-validation.pipe.js';

@UseGuards(OrganizationGuard)
@UsePipes(PayloadValidationPipe)
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  @UseGuards(ActiveGatewayGuard)
  create(
    @ActiveOrgId() orgId: string,
    @Body() createInvoiceDto: CreateInvoiceDto,
  ) {
    return this.invoicesService.create(orgId, createInvoiceDto);
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
    return this.invoicesService.findAll(orgId, pageNumber, limitNumber, {
      createdAt,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string, @ActiveOrgId() orgId: string) {
    return this.invoicesService.findOne(id, orgId);
  }
}
