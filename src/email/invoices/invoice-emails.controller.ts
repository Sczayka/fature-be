import {
  Body,
  Controller,
  Param,
  Post,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { ActiveOrgId, CurrentUser } from '../../auth/decorators.js';
import { OrganizationGuard } from '../../auth/organization.guard.js';
import { PayloadValidationPipe } from '../../common/pipes/payload-validation.pipe.js';
import { SendEmailDto } from '../dto/send-email.dto.js';
import { InvoiceEmailsService } from './invoice-emails.service.js';

/** "Enviar por e-mail" no detalhe da fatura. */
@UseGuards(OrganizationGuard)
@UsePipes(PayloadValidationPipe)
@Controller('invoices/:id/emails')
export class InvoiceEmailsController {
  constructor(private readonly invoiceEmails: InvoiceEmailsService) {}

  @Post()
  send(
    @ActiveOrgId() orgId: string,
    @Param('id') invoiceId: string,
    @Body() dto: SendEmailDto,
    @CurrentUser('id') userId: string | undefined,
  ) {
    return this.invoiceEmails.sendManual(orgId, invoiceId, {
      to: dto.to ?? null,
      requestedBy: userId ?? null,
    });
  }
}
