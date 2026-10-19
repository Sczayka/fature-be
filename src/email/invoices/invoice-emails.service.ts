import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { checkoutUrl } from '../../invoices/checkout-url.js';
import { displayInvoiceStatus } from '../../invoices/invoice-status.js';
import {
  INVOICE_STATUS,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
} from '../../invoices/invoices.constants.js';
import {
  daysBetween,
  todayInBillingTimezone,
} from '../../invoices/pricing/dates.js';
import {
  InvoicePricingRules,
  calcItemDiscount,
  getQuote,
  pricingRulesFromInvoice,
} from '../../invoices/pricing/invoice-pricing.js';
import { NOTIFICATION_SETTINGS_SELECT } from '../../organizations/notifications/notifications.constants.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EMAIL_SOURCE, EMAIL_TYPE } from '../email.constants.js';
import type { EmailReference, RenderedEmail } from '../email.types.js';
import {
  EmailLogView,
  EmailOutboxService,
} from '../outbox/email-outbox.service.js';
import type {
  BankSlipInfo,
  OpenInvoiceEmailData,
  PaymentOffer,
} from '../templates/invoice-content.js';
import { renderInvoiceIssuedEmail } from '../templates/invoice-issued.template.js';
import { renderInvoiceOverdueEmail } from '../templates/invoice-overdue.template.js';
import { renderInvoicePaidEmail } from '../templates/invoice-paid.template.js';
import { renderInvoiceReminderEmail } from '../templates/invoice-reminder.template.js';
import {
  PAYER_ORGANIZATION_SELECT,
  PayerContext,
  payerContext,
} from '../templates/payer.js';

export type InvoiceEmailType =
  | typeof EMAIL_TYPE.INVOICE_ISSUED
  | typeof EMAIL_TYPE.INVOICE_REMINDER
  | typeof EMAIL_TYPE.INVOICE_OVERDUE
  | typeof EMAIL_TYPE.INVOICE_PAID;

/** Interruptor da aba Notificações de cada e-mail automático. */
const AUTOMATIC_TOGGLES = {
  INVOICE_ISSUED: 'notifyInvoiceIssued',
  INVOICE_REMINDER: 'notifyInvoiceReminder',
  INVOICE_OVERDUE: 'notifyInvoiceOverdue',
  INVOICE_PAID: 'notifyInvoicePaid',
} as const satisfies Record<
  InvoiceEmailType,
  keyof typeof NOTIFICATION_SETTINGS_SELECT
>;

/** Envio manual: o modelo segue a situação da fatura. */
const MANUAL_TYPE_BY_STATUS = {
  PENDING: EMAIL_TYPE.INVOICE_ISSUED,
  OVERDUE: EMAIL_TYPE.INVOICE_OVERDUE,
  PAID: EMAIL_TYPE.INVOICE_PAID,
} as const;

export const NO_CLIENT_EMAIL_REASON = 'Cliente sem e-mail cadastrado.';

const INVOICE_EMAIL_SELECT = {
  id: true,
  organizationId: true,
  clientId: true,
  status: true,
  items: true,
  totalValue: true,
  dueDate: true,
  description: true,
  paymentMethods: true,
  discount: true,
  interestAndFine: true,
  checkoutToken: true,
  paidAt: true,
  paidMethod: true,
  paidValue: true,
  client: { select: { name: true, email: true } },
  organization: {
    select: { ...PAYER_ORGANIZATION_SELECT, ...NOTIFICATION_SETTINGS_SELECT },
  },
  charges: {
    select: { method: true, status: true, details: true },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.InvoiceSelect;

type InvoiceForEmail = Prisma.InvoiceGetPayload<{
  select: typeof INVOICE_EMAIL_SELECT;
}>;

interface StoredItem {
  id: string;
  name: string;
  quantity: number;
  total: number;
}

/** Campos de ChargeDetails lidos pelos e-mails. */
interface StoredChargeDetails {
  bankSlipUrl?: string | null;
  identificationField?: string | null;
  receiptUrl?: string | null;
}

/** E-mails ao pagador sobre uma fatura: emitida, lembrete, vencida e paga. */
@Injectable()
export class InvoiceEmailsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: EmailOutboxService,
  ) {}

  /**
   * E-mail automático: respeita a aba Notificações e sai uma vez por fatura e tipo. Cliente sem
   * e-mail fica registrado como não enviado. `deliverNow` envia na hora (eventos); o agendamento
   * só enfileira.
   */
  async sendAutomatic(
    invoiceId: string,
    type: InvoiceEmailType,
    { deliverNow, today }: { deliverNow: boolean; today: string },
  ): Promise<EmailLogView | null> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: INVOICE_EMAIL_SELECT,
    });

    if (!invoice || !invoice.organization[AUTOMATIC_TOGGLES[type]]) return null;

    const payer = payerContext(invoice.organization);
    const content = this.render(type, invoice, payer, today);
    const reference: EmailReference = {
      ...invoiceReference(invoice, type),
      source: EMAIL_SOURCE.AUTOMATIC,
      requestedBy: null,
      dedupeKey: automaticDedupeKey(type, invoice),
    };

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
      },
      { deliverNow },
    );
  }

  /** "Enviar por e-mail" no detalhe da fatura: o modelo segue a situação da fatura. */
  async sendManual(
    organizationId: string,
    invoiceId: string,
    { to, requestedBy }: { to: string | null; requestedBy: string | null },
  ): Promise<EmailLogView> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      select: INVOICE_EMAIL_SELECT,
    });

    if (!invoice) throw new NotFoundException('Fatura não encontrada');

    const today = todayInBillingTimezone();
    const status = displayInvoiceStatus(invoice.status, invoice.dueDate, today);

    if (status === INVOICE_STATUS.CANCELLED) {
      throw new ConflictException('Fatura cancelada não pode ser enviada.');
    }

    const recipient = to ?? invoice.client.email;

    if (!recipient) {
      throw new UnprocessableEntityException(
        'O cliente não tem e-mail cadastrado. Informe o destinatário.',
      );
    }

    if (await this.outbox.hasRecentManualSend({ invoiceId })) {
      throw new HttpException(
        'Esta fatura acabou de ser enviada. Aguarde um minuto para enviar de novo.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const type = MANUAL_TYPE_BY_STATUS[status];
    const payer = payerContext(invoice.organization);
    const log = await this.outbox.enqueue(
      {
        ...invoiceReference(invoice, type),
        source: EMAIL_SOURCE.MANUAL,
        requestedBy,
        dedupeKey: null,
        recipient,
        sender: payer.sender,
        replyTo: payer.replyTo,
        content: this.render(type, invoice, payer, today),
      },
      { deliverNow: true },
    );

    // Sem dedupeKey, o registro sempre é criado
    if (!log) throw new Error(`E-mail da fatura ${invoiceId} não registrado`);

    return log;
  }

  private render(
    type: InvoiceEmailType,
    invoice: InvoiceForEmail,
    payer: PayerContext,
    today: string,
  ): RenderedEmail {
    const rules = pricingRulesFromInvoice(invoice);

    switch (type) {
      case EMAIL_TYPE.INVOICE_ISSUED:
        return renderInvoiceIssuedEmail(
          openInvoiceData(invoice, payer, rules, today),
        );

      case EMAIL_TYPE.INVOICE_REMINDER:
        return renderInvoiceReminderEmail({
          ...openInvoiceData(invoice, payer, rules, today),
          daysUntilDue: daysBetween(today, rules.dueDate),
        });

      case EMAIL_TYPE.INVOICE_OVERDUE:
        return renderInvoiceOverdueEmail({
          payer,
          clientName: invoice.client.name,
          description: invoice.description,
          totalValue: invoice.totalValue,
          dueDate: rules.dueDate,
          // Em atraso o valor é o mesmo para todas as formas: nominal + multa + juros
          amountToday: getQuote(
            rules,
            (invoice.paymentMethods[0] ?? 'PIX') as PaymentMethod,
            today,
          ).total,
          checkoutUrl: checkoutUrl(invoice.checkoutToken),
        });

      case EMAIL_TYPE.INVOICE_PAID:
        return renderInvoicePaidEmail({
          payer,
          clientName: invoice.client.name,
          description: invoice.description,
          paidAt: paidDate(invoice.paidAt ?? new Date()),
          paidValue: invoice.paidValue ?? invoice.totalValue,
          methodLabel: methodLabel(invoice.paidMethod),
          receiptUrl: receiptUrl(invoice),
          checkoutUrl: checkoutUrl(invoice.checkoutToken),
        });
    }
  }
}

function invoiceReference(invoice: InvoiceForEmail, type: InvoiceEmailType) {
  return {
    organizationId: invoice.organizationId,
    clientId: invoice.clientId,
    invoiceId: invoice.id,
    invoiceDraftId: null,
    type,
  };
}

/** Um aviso por fatura; lembrete e vencida também por vencimento. */
export function automaticDedupeKey(
  type: InvoiceEmailType,
  invoice: { id: string; dueDate: Date },
): string {
  const dueDate = invoice.dueDate.toISOString().slice(0, 10);

  switch (type) {
    case EMAIL_TYPE.INVOICE_ISSUED:
      return `invoice-issued:${invoice.id}`;
    case EMAIL_TYPE.INVOICE_PAID:
      return `invoice-paid:${invoice.id}`;
    case EMAIL_TYPE.INVOICE_REMINDER:
      return `invoice-reminder:${invoice.id}:${dueDate}`;
    case EMAIL_TYPE.INVOICE_OVERDUE:
      return `invoice-overdue:${invoice.id}:${dueDate}`;
  }
}

function openInvoiceData(
  invoice: InvoiceForEmail,
  payer: PayerContext,
  rules: InvoicePricingRules,
  today: string,
): OpenInvoiceEmailData {
  const methods = invoice.paymentMethods as PaymentMethod[];
  const offers: PaymentOffer[] = methods.flatMap((method) => {
    const quote = getQuote(rules, method, today);

    return quote.methodDiscount > 0
      ? [
          {
            methodLabel: PAYMENT_METHOD_LABELS[method] ?? method,
            total: quote.total,
            until: quote.validUntil,
          },
        ]
      : [];
  });

  return {
    payer,
    clientName: invoice.client.name,
    description: invoice.description,
    // Valor de cada item já com o desconto do item: a soma bate com o valor da fatura
    items: (invoice.items as unknown as StoredItem[]).map((item) => ({
      name: item.name,
      quantity: item.quantity,
      total: item.total - calcItemDiscount(rules, item),
    })),
    totalValue: invoice.totalValue,
    dueDate: rules.dueDate,
    paymentMethodLabels: methods.map(
      (method) => PAYMENT_METHOD_LABELS[method] ?? method,
    ),
    offers,
    checkoutUrl: checkoutUrl(invoice.checkoutToken),
    bankSlip: openBankSlip(invoice),
  };
}

function chargeDetails(details: Prisma.JsonValue): StoredChargeDetails {
  return details && typeof details === 'object' && !Array.isArray(details)
    ? (details as StoredChargeDetails)
    : {};
}

function openBankSlip(invoice: InvoiceForEmail): BankSlipInfo | null {
  const charge = invoice.charges.find(
    (row) => row.method === 'BANK_SLIP' && row.status === 'PENDING',
  );

  if (!charge) return null;

  const details = chargeDetails(charge.details);

  return {
    identificationField: details.identificationField ?? null,
    url: details.bankSlipUrl ?? null,
  };
}

function receiptUrl(invoice: InvoiceForEmail): string | null {
  const paidCharges = invoice.charges.filter((row) => row.status === 'PAID');
  const charge =
    paidCharges.find((row) => row.method === invoice.paidMethod) ??
    paidCharges[0];

  return charge ? (chargeDetails(charge.details).receiptUrl ?? null) : null;
}

function methodLabel(method: string | null): string | null {
  if (!method) return null;

  return PAYMENT_METHOD_LABELS[method as PaymentMethod] ?? method;
}

/**
 * Data do pagamento: o provedor informa só a data (gravada à meia-noite UTC); o cartão aprovado
 * na hora grava o instante, convertido para o fuso de cobrança.
 */
export function paidDate(paidAt: Date): string {
  const iso = paidAt.toISOString();

  return iso.endsWith('T00:00:00.000Z')
    ? iso.slice(0, 10)
    : todayInBillingTimezone(paidAt);
}
