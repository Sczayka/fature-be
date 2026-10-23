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
import { InvoiceTotalsQueryDto } from './dto/invoice-totals-query.dto.js';
import { ListInvoicesQueryDto } from './dto/list-invoices-query.dto.js';
import { OrganizationGuard } from '../auth/organization.guard.js';
import { ActiveGatewayGuard } from '../auth/active-gateway.guard.js';
import { ActiveOrgId, CurrentUser } from '../auth/decorators.js';
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
    @CurrentUser('id') userId: string,
    @Body() createInvoiceDto: CreateInvoiceDto,
  ) {
    return this.invoicesService.create(orgId, createInvoiceDto, userId);
  }

  @Get()
  findAll(@ActiveOrgId() orgId: string, @Query() query: ListInvoicesQueryDto) {
    return this.invoicesService.findAll(orgId, query);
  }

  /** Em aberto, vencido e pago, da organização ou de um cliente (antes de `:id`). */
  @Get('totals')
  totals(@ActiveOrgId() orgId: string, @Query() query: InvoiceTotalsQueryDto) {
    return this.invoicesService.totals(orgId, query.clientId || null);
  }

  /** Faturas com comprovante a conferir, para o número no menu (antes de `:id`). */
  @Get('awaiting-confirmation/count')
  awaitingConfirmationCount(@ActiveOrgId() orgId: string) {
    return this.invoicesService.awaitingConfirmationCount(orgId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @ActiveOrgId() orgId: string) {
    return this.invoicesService.findOne(id, orgId);
  }
}
