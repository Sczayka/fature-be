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
import { QuoteEmailsService } from './quote-emails.service.js';

/** "Enviar via e-mail" no detalhe do orçamento. */
@UseGuards(OrganizationGuard)
@UsePipes(PayloadValidationPipe)
@Controller('invoices/drafts/:id/emails')
export class QuoteEmailsController {
  constructor(private readonly quoteEmails: QuoteEmailsService) {}

  @Post()
  send(
    @ActiveOrgId() orgId: string,
    @Param('id') draftId: string,
    @Body() dto: SendEmailDto,
    @CurrentUser('id') userId: string | undefined,
  ) {
    return this.quoteEmails.send(orgId, draftId, {
      to: dto.to ?? null,
      requestedBy: userId ?? null,
    });
  }
}
