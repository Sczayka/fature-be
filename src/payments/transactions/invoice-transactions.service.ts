import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { InvoiceTransaction } from '@prisma/client';
import { randomUUID } from 'crypto';
import { InvoiceReceiptsService } from '../../financial/receipts/invoice-receipts.service.js';
import type { InvoicePaidEvent } from '../../invoices/invoice-events.js';
import {
  INVOICE_STATUS,
  type InvoiceStatus,
} from '../../invoices/invoices.constants.js';
import { todayInBillingTimezone } from '../../invoices/pricing/dates.js';
import { pricingRulesFromInvoice } from '../../invoices/pricing/invoice-pricing.js';
import { computeInvoiceBalance } from './invoice-balance.js';
import {
  BALANCE_TRANSACTION_SELECT,
  TRANSACTION_SOURCE,
  TRANSACTION_STATUS,
  TRANSACTION_TYPE,
} from './transactions.constants.js';

export interface GatewayPayment {
  invoiceId: string;
  chargeId: string;
  method: string;
  amount: number;
  occurredAt: Date;
}

export interface RecordedPayment {
  transaction: InvoiceTransaction;
  /** false quando a cobrança já tinha o pagamento registrado (evento repetido). */
  created: boolean;
}

export interface AppliedBalance {
  status: InvoiceStatus;
  /** Só quando a fatura acabou de ser paga; quem chamou o emite depois do commit. */
  paidEvent: InvoicePaidEvent | null;
}

const BALANCE_INVOICE_SELECT = {
  id: true,
  organizationId: true,
  status: true,
  items: true,
  dueDate: true,
  discount: true,
  interestAndFine: true,
  transactions: { select: BALANCE_TRANSACTION_SELECT },
} satisfies Prisma.InvoiceSelect;

/**
 * Movimentações da fatura (InvoiceTransaction): o dinheiro que entrou e saiu. A situação da
 * fatura (paga, valor recebido, excedente) é recalculada delas a cada transação nova, confirmada
 * ou cancelada, e os recebimentos do financeiro acompanham. Rode sempre dentro do lock da fatura
 * (`ChargesService.withInvoiceLock`).
 */
@Injectable()
export class InvoiceTransactionsService {
  constructor(private readonly receipts: InvoiceReceiptsService) {}

  /** Pagamento confirmado pelo provedor. Idempotente: um PAYMENT por cobrança. */
  async recordGatewayPayment(
    tx: Prisma.TransactionClient,
    { invoiceId, chargeId, method, amount, occurredAt }: GatewayPayment,
  ): Promise<RecordedPayment> {
    const existing = await tx.invoiceTransaction.findFirst({
      where: { chargeId, type: TRANSACTION_TYPE.PAYMENT },
    });

    if (existing) return { transaction: existing, created: false };

    const transaction = await tx.invoiceTransaction.create({
      data: {
        id: randomUUID(),
        invoiceId,
        chargeId,
        type: TRANSACTION_TYPE.PAYMENT,
        method,
        amount,
        occurredAt,
        status: TRANSACTION_STATUS.CONFIRMED,
        source: TRANSACTION_SOURCE.GATEWAY,
      },
    });

    return { transaction, created: true };
  }

  /** Só os recebimentos do financeiro, sem recalcular a fatura (ex.: a data de crédito mudou). */
  syncReceipts(tx: Prisma.TransactionClient, invoiceId: string): Promise<void> {
    return this.receipts.sync(tx, invoiceId);
  }

  /**
   * Grava na fatura a situação calculada das transações: status, pagamento que quitou, recebido
   * líquido e excedente. Sem quitação, o comprovante aguardando conferência deixa a fatura
   * AWAITING_CONFIRMATION. Cancelada não muda, e a paga que nunca teve pagamento confirmado (paga
   * antes das cobranças) fica como está. Os recebimentos do financeiro são sincronizados em
   * qualquer caso: o dinheiro que entrou numa fatura cancelada também está no caixa.
   */
  async applyBalance(
    tx: Prisma.TransactionClient,
    invoiceId: string,
  ): Promise<AppliedBalance> {
    await this.receipts.sync(tx, invoiceId);

    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: BALANCE_INVOICE_SELECT,
    });
    const current = invoice.status as InvoiceStatus;

    if (current === INVOICE_STATUS.CANCELLED) {
      return { status: current, paidEvent: null };
    }

    // O cancelado também conta: ele quitava a fatura antes de ser cancelado
    const hadConfirmedPayment = invoice.transactions.some(
      (row) =>
        row.type === TRANSACTION_TYPE.PAYMENT &&
        (row.status === TRANSACTION_STATUS.CONFIRMED ||
          row.status === TRANSACTION_STATUS.CANCELLED),
    );

    if (current === INVOICE_STATUS.PAID && !hadConfirmedPayment) {
      return { status: current, paidEvent: null };
    }

    const balance = computeInvoiceBalance(
      pricingRulesFromInvoice(invoice),
      invoice.transactions,
      todayInBillingTimezone(),
    );
    const settledBy = balance.settledBy;
    // Comprovante enviado pelo pagador e ainda não conferido pela empresa
    const hasPendingReview = invoice.transactions.some(
      (row) =>
        row.type === TRANSACTION_TYPE.PAYMENT &&
        row.status === TRANSACTION_STATUS.PENDING_REVIEW,
    );
    const status: InvoiceStatus = settledBy
      ? INVOICE_STATUS.PAID
      : hasPendingReview
        ? INVOICE_STATUS.AWAITING_CONFIRMATION
        : current === INVOICE_STATUS.OVERDUE
          ? INVOICE_STATUS.OVERDUE
          : INVOICE_STATUS.PENDING;
    const paidAt = settledBy?.occurredAt ?? null;

    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        status,
        paidAt,
        paidMethod: settledBy?.method ?? null,
        paidValue: settledBy ? balance.net : null,
        excessValue: balance.excess,
      },
    });

    const justPaid =
      current !== INVOICE_STATUS.PAID && settledBy !== null && paidAt !== null;

    return {
      status,
      paidEvent: justPaid
        ? {
            invoiceId: invoice.id,
            organizationId: invoice.organizationId,
            transactionId: settledBy.id,
            chargeId: settledBy.chargeId,
            method: settledBy.method,
            paidAt: paidAt.toISOString(),
            paidValue: balance.net,
          }
        : null,
    };
  }
}
