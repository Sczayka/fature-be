import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  addDays,
  paidDate,
  todayInBillingTimezone,
  utcMidnight,
} from '../../invoices/pricing/dates.js';
import {
  TRANSACTION_SOURCE,
  TRANSACTION_STATUS,
  TRANSACTION_TYPE,
} from '../../payments/transactions/transactions.constants.js';
import {
  ENTRY_DIRECTION,
  ENTRY_ORIGIN,
  ENTRY_STATUS,
} from '../financial.constants.js';
import { toDateOnly } from '../financial-dates.js';
import { setupOrganizationFinancial } from '../setup/organization-financial-setup.js';

/** O que o recebimento copia da movimentação e da cobrança do provedor. */
const RECEIPT_TRANSACTION_SELECT = {
  id: true,
  type: true,
  method: true,
  amount: true,
  occurredAt: true,
  status: true,
  source: true,
  charge: {
    select: {
      feeAmount: true,
      creditDate: true,
      paymentGatewayAccountId: true,
    },
  },
} satisfies Prisma.InvoiceTransactionSelect;

export type ReceiptTransaction = Prisma.InvoiceTransactionGetPayload<{
  select: typeof RECEIPT_TRANSACTION_SELECT;
}>;

/** Contas em que os recebimentos das faturas caem. */
interface ReceiptAccounts {
  mainId: string;
  /** Conta do caixa de cada conta da organização no provedor. */
  byGatewayAccount: Map<string, string>;
}

/** Valor, datas e forma: a parte do lançamento que acompanha a movimentação. */
export interface ReceiptValues {
  direction: string;
  description: string;
  amount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  feeAmount: Prisma.Decimal;
  paymentDate: Date;
  settlementDate: Date;
  paymentMethod: string;
}

const ZERO = new Prisma.Decimal(0);

function isFromGateway(transaction: ReceiptTransaction): boolean {
  return (
    transaction.source === TRANSACTION_SOURCE.GATEWAY &&
    transaction.charge !== null
  );
}

/**
 * Lançamento da movimentação confirmada; null quando ela não está (mais) confirmada.
 * - Pagamento do provedor: a taxa da cobrança sai do bruto, e o dinheiro cai na data de crédito
 *   informada pelo provedor ou, sem ela, `receiptDays` depois do pagamento.
 * - Pagamento manual (PIX da empresa e transferência) e devolução: sem taxa, no dia.
 */
export function toReceiptValues(
  transaction: ReceiptTransaction,
  receiptDays: number,
): ReceiptValues | null {
  const { amount, occurredAt } = transaction;

  if (
    transaction.status !== TRANSACTION_STATUS.CONFIRMED ||
    amount === null ||
    occurredAt === null
  ) {
    return null;
  }

  const isPayment = transaction.type === TRANSACTION_TYPE.PAYMENT;
  const paymentDay = paidDate(occurredAt);
  const charge = isFromGateway(transaction) ? transaction.charge : null;
  const fee =
    charge && isPayment
      ? Prisma.Decimal.min(new Prisma.Decimal(charge.feeAmount), amount)
      : ZERO;
  const creditDay = charge?.creditDate
    ? toDateOnly(charge.creditDate)
    : addDays(paymentDay, charge && isPayment ? receiptDays : 0);

  return {
    direction: isPayment ? ENTRY_DIRECTION.IN : ENTRY_DIRECTION.OUT,
    description: isPayment ? 'Pagamento de fatura' : 'Devolução de fatura',
    amount,
    paidAmount: amount,
    feeAmount: fee,
    paymentDate: utcMidnight(paymentDay),
    // O crédito nunca vem antes do pagamento
    settlementDate: utcMidnight(
      creditDay > paymentDay ? creditDay : paymentDay,
    ),
    paymentMethod: transaction.method,
  };
}

/**
 * Recebimentos das faturas no financeiro: cada movimentação confirmada da fatura vira um
 * lançamento pago (o pagamento entra, a devolução sai), e a que deixou de estar confirmada
 * cancela o seu. O do provedor cai na conta dele; o manual e a devolução, na conta principal.
 */
@Injectable()
export class InvoiceReceiptsService {
  /**
   * Sincroniza os lançamentos com as movimentações da fatura. Idempotente: valor, datas e situação
   * acompanham a movimentação; a conta, a categoria e a observação são da empresa e ficam como
   * estão. Rode na transação que mudou a movimentação (InvoiceTransactionsService.applyBalance).
   */
  async sync(tx: Prisma.TransactionClient, invoiceId: string): Promise<void> {
    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        organizationId: true,
        clientId: true,
        transactions: { select: RECEIPT_TRANSACTION_SELECT },
      },
    });

    if (!invoice || invoice.transactions.length === 0) return;

    const entries = await tx.financialEntry.findMany({
      where: {
        invoiceTransactionId: {
          in: invoice.transactions.map((transaction) => transaction.id),
        },
      },
      select: { id: true, invoiceTransactionId: true, status: true },
    });
    const entryByTransaction = new Map(
      entries.map((entry) => [entry.invoiceTransactionId, entry]),
    );
    const receiptDays = await this.loadReceiptDays(tx, invoice.transactions);
    let accounts: ReceiptAccounts | null = null;

    for (const transaction of invoice.transactions) {
      const entry = entryByTransaction.get(transaction.id);
      const values = toReceiptValues(
        transaction,
        receiptDays.get(receiptDaysKey(transaction)) ?? 0,
      );

      if (!values) {
        if (entry && entry.status !== ENTRY_STATUS.CANCELLED) {
          await tx.financialEntry.update({
            where: { id: entry.id },
            data: { status: ENTRY_STATUS.CANCELLED },
          });
        }

        continue;
      }

      if (entry) {
        await tx.financialEntry.update({
          where: { id: entry.id },
          data: { ...values, status: ENTRY_STATUS.PAID },
        });
        continue;
      }

      accounts ??= await this.loadAccounts(tx, invoice.organizationId);

      await tx.financialEntry.create({
        data: {
          ...values,
          organizationId: invoice.organizationId,
          origin: ENTRY_ORIGIN.INVOICE,
          status: ENTRY_STATUS.PAID,
          accountId: accountFor(transaction, accounts),
          invoiceId,
          invoiceTransactionId: transaction.id,
          clientId: invoice.clientId,
        },
      });
    }
  }

  /** Dias até o crédito de cada forma, nas contas do provedor das cobranças da fatura. */
  private async loadReceiptDays(
    tx: Prisma.TransactionClient,
    transactions: ReceiptTransaction[],
  ): Promise<Map<string, number>> {
    const gatewayAccountIds = [
      ...new Set(
        transactions.flatMap((transaction) =>
          transaction.charge
            ? [transaction.charge.paymentGatewayAccountId]
            : [],
        ),
      ),
    ];

    if (gatewayAccountIds.length === 0) return new Map();

    const methods = await tx.paymentGatewayMethod.findMany({
      where: { paymentGatewayAccountId: { in: gatewayAccountIds } },
      select: {
        paymentGatewayAccountId: true,
        method: true,
        receiptDays: true,
      },
    });

    return new Map(
      methods.map((row) => [
        `${row.paymentGatewayAccountId}:${row.method}`,
        row.receiptDays,
      ]),
    );
  }

  /** A principal e as dos provedores; faltando alguma, a configuração padrão cria. */
  private async loadAccounts(
    tx: Prisma.TransactionClient,
    organizationId: string,
  ): Promise<ReceiptAccounts> {
    const find = () =>
      tx.financialAccount.findMany({
        where: {
          organizationId,
          OR: [{ isMain: true }, { paymentGatewayAccountId: { not: null } }],
        },
        select: { id: true, isMain: true, paymentGatewayAccountId: true },
      });

    let accounts = await find();
    const gatewayAccounts = await tx.paymentGatewayAccount.count({
      where: { organizationId },
    });
    const providerAccounts = accounts.filter(
      (account) => account.paymentGatewayAccountId,
    );

    if (
      !accounts.some((account) => account.isMain) ||
      providerAccounts.length < gatewayAccounts
    ) {
      await setupOrganizationFinancial(
        tx,
        organizationId,
        todayInBillingTimezone(),
      );
      accounts = await find();
    }

    const main = accounts.find((account) => account.isMain);

    if (!main) {
      throw new Error(
        `Organização ${organizationId} sem conta principal no financeiro`,
      );
    }

    return {
      mainId: main.id,
      byGatewayAccount: new Map(
        accounts.flatMap((account) =>
          account.paymentGatewayAccountId
            ? [[account.paymentGatewayAccountId, account.id]]
            : [],
        ),
      ),
    };
  }
}

function receiptDaysKey(transaction: ReceiptTransaction): string {
  return transaction.charge
    ? `${transaction.charge.paymentGatewayAccountId}:${transaction.method}`
    : '';
}

function accountFor(
  transaction: ReceiptTransaction,
  accounts: ReceiptAccounts,
): string {
  const providerAccount =
    isFromGateway(transaction) && transaction.charge
      ? accounts.byGatewayAccount.get(
          transaction.charge.paymentGatewayAccountId,
        )
      : undefined;

  return providerAccount ?? accounts.mainId;
}
