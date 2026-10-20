import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { frontendUrl } from '../../common/utils/public-url.js';
import { checkoutUrl } from '../../invoices/checkout-url.js';
import type { InvoiceTransactionEvent } from '../../invoices/invoice-events.js';
import {
  INVOICE_DETAIL_PATH,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
} from '../../invoices/invoices.constants.js';
import { todayInBillingTimezone } from '../../invoices/pricing/dates.js';
import { pricingRulesFromInvoice } from '../../invoices/pricing/invoice-pricing.js';
import {
  computeInvoiceBalance,
  type InvoiceBalance,
} from '../../payments/transactions/invoice-balance.js';
import { BALANCE_TRANSACTION_SELECT } from '../../payments/transactions/transactions.constants.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EMAIL_SOURCE, EMAIL_TYPE } from '../email.constants.js';
import type { EmailReference, RenderedEmail } from '../email.types.js';
import {
  EmailLogView,
  EmailOutboxService,
} from '../outbox/email-outbox.service.js';
import { fatureSender } from '../sender.js';
import { fatureBrand } from '../templates/brand.js';
import { renderInvoicePartiallyPaidEmail } from '../templates/invoice-partially-paid.template.js';
import { renderPaymentProofReceivedEmail } from '../templates/payment-proof-received.template.js';
import { renderPaymentProofRejectedEmail } from '../templates/payment-proof-rejected.template.js';
import {
  PAYER_ORGANIZATION_SELECT,
  PayerContext,
  payerContext,
} from '../templates/payer.js';
import { NO_CLIENT_EMAIL_REASON } from './invoice-emails.service.js';

export type PaymentProofEmailType =
  | typeof EMAIL_TYPE.PAYMENT_PROOF_RECEIVED
  | typeof EMAIL_TYPE.PAYMENT_PROOF_REJECTED
  | typeof EMAIL_TYPE.INVOICE_PARTIALLY_PAID;

/** Interruptor da aba Notificações de cada aviso do pagamento manual. */
const TOGGLES = {
  PAYMENT_PROOF_RECEIVED: 'notifyPaymentProofReceived',
  PAYMENT_PROOF_REJECTED: 'notifyPaymentProofRejected',
  INVOICE_PARTIALLY_PAID: 'notifyPartialPayment',
} as const satisfies Record<PaymentProofEmailType, string>;

/** Um aviso por transação. */
const DEDUPE_PREFIXES = {
  PAYMENT_PROOF_RECEIVED: 'payment-proof-received',
  PAYMENT_PROOF_REJECTED: 'payment-proof-rejected',
  INVOICE_PARTIALLY_PAID: 'invoice-partially-paid',
} as const satisfies Record<PaymentProofEmailType, string>;

const PAYMENT_PROOF_INVOICE_SELECT = {
  id: true,
  organizationId: true,
  clientId: true,
  items: true,
  dueDate: true,
  description: true,
  discount: true,
  interestAndFine: true,
  checkoutToken: true,
  client: { select: { name: true, email: true } },
  organization: {
    select: {
      ...PAYER_ORGANIZATION_SELECT,
      notifyPaymentProofReceived: true,
      notifyPaymentProofRejected: true,
      notifyPartialPayment: true,
    },
  },
  transactions: {
    select: { ...BALANCE_TRANSACTION_SELECT, statusReason: true },
  },
} satisfies Prisma.InvoiceSelect;

type InvoiceForProofEmail = Prisma.InvoiceGetPayload<{
  select: typeof PAYMENT_PROOF_INVOICE_SELECT;
}>;

type ProofTransaction = InvoiceForProofEmail['transactions'][number];

/**
 * Avisos do pagamento manual: à empresa quando chega um comprovante, e ao pagador quando o
 * comprovante é recusado ou o valor confirmado não cobre a fatura. Respeitam a aba Notificações e
 * saem uma vez por transação.
 */
@Injectable()
export class PaymentProofEmailsService {
  private readonly logger = new Logger(PaymentProofEmailsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: EmailOutboxService,
  ) {}

  /**
   * À empresa, fora do histórico do cliente (sem clientId): o e-mail de contato ou, sem ele, o do
   * dono da organização.
   */
  async sendReceived(
    event: InvoiceTransactionEvent,
  ): Promise<EmailLogView | null> {
    const type = EMAIL_TYPE.PAYMENT_PROOF_RECEIVED;
    const loaded = await this.load(event, type);

    if (!loaded) return null;

    const { invoice, transaction, balance } = loaded;
    const recipient =
      invoice.organization.contactEmail ??
      (await this.ownerEmail(invoice.organizationId));

    if (!recipient) {
      this.logger.warn(
        `Comprovante da fatura ${invoice.id} sem destinatário na organização ${invoice.organizationId}: sem e-mail de contato nem dono`,
      );
      return null;
    }

    return this.outbox.enqueue(
      {
        ...this.reference(invoice, type, event.transactionId),
        clientId: null,
        recipient,
        sender: fatureSender(),
        replyTo: null,
        content: renderPaymentProofReceivedEmail({
          brand: fatureBrand(),
          clientName: invoice.client.name,
          description: invoice.description,
          methodLabel: methodLabel(transaction.method),
          amountToday: balance.due ?? 0,
          received: balance.net,
          dueDate: invoice.dueDate.toISOString().slice(0, 10),
          invoiceUrl: `${frontendUrl()}${INVOICE_DETAIL_PATH}/${invoice.id}`,
        }),
        attachments: [],
      },
      { deliverNow: true },
    );
  }

  /** Ao pagador: o comprovante não foi aceito, com o motivo informado pela empresa. */
  async sendRejected(
    event: InvoiceTransactionEvent,
  ): Promise<EmailLogView | null> {
    const type = EMAIL_TYPE.PAYMENT_PROOF_REJECTED;
    const loaded = await this.load(event, type);

    if (!loaded) return null;

    const { invoice, transaction } = loaded;
    const payer = payerContext(invoice.organization);

    return this.sendToPayer(
      invoice,
      type,
      event.transactionId,
      payer,
      renderPaymentProofRejectedEmail({
        payer,
        clientName: invoice.client.name,
        description: invoice.description,
        reason: transaction.statusReason ?? '',
        checkoutUrl: checkoutUrl(invoice.checkoutToken),
      }),
    );
  }

  /** Ao pagador: o valor confirmado não cobriu a fatura, com o saldo de hoje. */
  async sendPartiallyPaid(
    event: InvoiceTransactionEvent,
  ): Promise<EmailLogView | null> {
    const type = EMAIL_TYPE.INVOICE_PARTIALLY_PAID;
    const loaded = await this.load(event, type);

    if (!loaded) return null;

    const { invoice, transaction, balance } = loaded;
    const payer = payerContext(invoice.organization);

    return this.sendToPayer(
      invoice,
      type,
      event.transactionId,
      payer,
      renderInvoicePartiallyPaidEmail({
        payer,
        clientName: invoice.client.name,
        description: invoice.description,
        amount: transaction.amount?.toNumber() ?? 0,
        received: balance.net,
        balance: balance.balance ?? 0,
        checkoutUrl: checkoutUrl(invoice.checkoutToken),
      }),
    );
  }

  /** A fatura e a transação do aviso; null com o aviso desligado ou sem os dados. */
  private async load(
    event: InvoiceTransactionEvent,
    type: PaymentProofEmailType,
  ): Promise<{
    invoice: InvoiceForProofEmail;
    transaction: ProofTransaction;
    balance: InvoiceBalance;
  } | null> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: event.invoiceId },
      select: PAYMENT_PROOF_INVOICE_SELECT,
    });

    if (!invoice || !invoice.organization[TOGGLES[type]]) return null;

    const transaction = invoice.transactions.find(
      (row) => row.id === event.transactionId,
    );

    if (!transaction) return null;

    const balance = computeInvoiceBalance(
      pricingRulesFromInvoice(invoice),
      invoice.transactions,
      todayInBillingTimezone(),
    );

    return { invoice, transaction, balance };
  }

  /** Cliente sem e-mail fica registrado como não enviado, como nos avisos da fatura. */
  private sendToPayer(
    invoice: InvoiceForProofEmail,
    type: PaymentProofEmailType,
    transactionId: string,
    payer: PayerContext,
    content: RenderedEmail,
  ): Promise<EmailLogView | null> {
    const reference = this.reference(invoice, type, transactionId);

    if (!invoice.client.email) {
      return this.outbox.recordSkipped({
        ...reference,
        sender: payer.sender,
        subject: content.subject,
        reason: NO_CLIENT_EMAIL_REASON,
      });
    }

    return this.outbox.enqueue(
      {
        ...reference,
        recipient: invoice.client.email,
        sender: payer.sender,
        replyTo: payer.replyTo,
        content,
        attachments: [],
      },
      { deliverNow: true },
    );
  }

  private reference(
    invoice: InvoiceForProofEmail,
    type: PaymentProofEmailType,
    transactionId: string,
  ): EmailReference {
    return {
      organizationId: invoice.organizationId,
      clientId: invoice.clientId,
      invoiceId: invoice.id,
      invoiceDraftId: null,
      type,
      source: EMAIL_SOURCE.AUTOMATIC,
      requestedBy: null,
      dedupeKey: `${DEDUPE_PREFIXES[type]}:${transactionId}`,
    };
  }

  /** E-mail do dono mais antigo da organização. */
  private async ownerEmail(organizationId: string): Promise<string | null> {
    const owner = await this.prisma.member.findFirst({
      where: { organizationId, role: 'owner' },
      orderBy: { createdAt: 'asc' },
      select: { user: { select: { email: true } } },
    });

    return owner?.user.email ?? null;
  }
}

function methodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method as PaymentMethod] ?? method;
}
