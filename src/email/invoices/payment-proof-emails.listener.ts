import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  INVOICE_PARTIALLY_PAID_EVENT,
  PAYMENT_PROOF_RECEIVED_EVENT,
  PAYMENT_PROOF_REJECTED_EVENT,
  type InvoiceTransactionEvent,
} from '../../invoices/invoice-events.js';
import { PaymentProofEmailsService } from './payment-proof-emails.service.js';

/**
 * E-mails do pagamento manual, disparados pelos eventos já depois do commit. Uma falha aqui não
 * desfaz o envio, a conferência ou o pagamento: fica só no log.
 */
@Injectable()
export class PaymentProofEmailsListener {
  private readonly logger = new Logger(PaymentProofEmailsListener.name);

  constructor(private readonly paymentProofEmails: PaymentProofEmailsService) {}

  @OnEvent(PAYMENT_PROOF_RECEIVED_EVENT, { async: true })
  async onProofReceived(event: InvoiceTransactionEvent): Promise<void> {
    await this.send(event, 'PAYMENT_PROOF_RECEIVED', () =>
      this.paymentProofEmails.sendReceived(event),
    );
  }

  @OnEvent(PAYMENT_PROOF_REJECTED_EVENT, { async: true })
  async onProofRejected(event: InvoiceTransactionEvent): Promise<void> {
    await this.send(event, 'PAYMENT_PROOF_REJECTED', () =>
      this.paymentProofEmails.sendRejected(event),
    );
  }

  @OnEvent(INVOICE_PARTIALLY_PAID_EVENT, { async: true })
  async onPartiallyPaid(event: InvoiceTransactionEvent): Promise<void> {
    await this.send(event, 'INVOICE_PARTIALLY_PAID', () =>
      this.paymentProofEmails.sendPartiallyPaid(event),
    );
  }

  private async send(
    event: InvoiceTransactionEvent,
    type: string,
    work: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await work();
    } catch (error) {
      this.logger.error(
        `E-mail ${type} da fatura ${event.invoiceId} (transação ${event.transactionId}) não registrado`,
        error,
      );
    }
  }
}
