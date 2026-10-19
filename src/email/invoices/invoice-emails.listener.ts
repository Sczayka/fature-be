import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  INVOICE_ISSUED_EVENT,
  INVOICE_PAID_EVENT,
  type InvoiceIssuedEvent,
  type InvoicePaidEvent,
} from '../../invoices/invoice-events.js';
import { todayInBillingTimezone } from '../../invoices/pricing/dates.js';
import { EMAIL_TYPE } from '../email.constants.js';
import {
  InvoiceEmailType,
  InvoiceEmailsService,
} from './invoice-emails.service.js';

/**
 * E-mails disparados pelos eventos da fatura, já depois do commit. Uma falha aqui não desfaz a
 * emissão nem o pagamento: fica no log, e a reconciliação do agendamento tenta de novo.
 */
@Injectable()
export class InvoiceEmailsListener {
  private readonly logger = new Logger(InvoiceEmailsListener.name);

  constructor(private readonly invoiceEmails: InvoiceEmailsService) {}

  @OnEvent(INVOICE_ISSUED_EVENT, { async: true })
  async onInvoiceIssued({ invoiceId }: InvoiceIssuedEvent): Promise<void> {
    await this.send(invoiceId, EMAIL_TYPE.INVOICE_ISSUED);
  }

  @OnEvent(INVOICE_PAID_EVENT, { async: true })
  async onInvoicePaid({ invoiceId }: InvoicePaidEvent): Promise<void> {
    await this.send(invoiceId, EMAIL_TYPE.INVOICE_PAID);
  }

  private async send(invoiceId: string, type: InvoiceEmailType): Promise<void> {
    try {
      await this.invoiceEmails.sendAutomatic(invoiceId, type, {
        deliverNow: true,
        today: todayInBillingTimezone(),
      });
    } catch (error) {
      this.logger.error(
        `E-mail ${type} da fatura ${invoiceId} não registrado`,
        error,
      );
    }
  }
}
