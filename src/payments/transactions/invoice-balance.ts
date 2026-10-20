import { Prisma } from '@prisma/client';
import { paidDate } from '../../invoices/pricing/dates.js';
import {
  InvoicePricingRules,
  getQuote,
  roundCurrency,
} from '../../invoices/pricing/invoice-pricing.js';
import type { PaymentMethod } from '../payments.constants.js';
import {
  BALANCE_TRANSACTION_SELECT,
  TRANSACTION_SOURCE,
  TRANSACTION_STATUS,
  TRANSACTION_TYPE,
} from './transactions.constants.js';

export type BalanceTransaction = Prisma.InvoiceTransactionGetPayload<{
  select: typeof BALANCE_TRANSACTION_SELECT;
}>;

export interface InvoiceBalance {
  /** PAYMENT confirmados. */
  totalPaid: number;
  /** REFUND confirmados. */
  totalRefunded: number;
  /** totalPaid - totalRefunded */
  net: number;
  /** Valor devido: o da quitação; sem quitação, o valor de hoje pela forma já usada; null sem forma definida. */
  due: number | null;
  /** due - net (negativo = excedente); null quando due é null. */
  balance: number | null;
  /** Excedente ainda não devolvido (>= 0). */
  excess: number;
  /** Transação que quitou a fatura; null enquanto não quitada. */
  settledBy: BalanceTransaction | null;
}

interface Settlement {
  transaction: BalanceTransaction;
  due: Prisma.Decimal;
}

const ZERO = new Prisma.Decimal(0);

/**
 * Situação da fatura a partir das transações (card Movimentações da fatura). Os pagamentos
 * confirmados são percorridos em ordem de data:
 * - o do provedor quita na hora, e o valor devido é o dele (o Fature calculou ao gerar a cobrança);
 * - o manual quita quando o acumulado chega ao valor do dia na forma e na data dele.
 * Vale o primeiro que quita; o que vier depois é excedente. `today` no formato YYYY-MM-DD.
 */
export function computeInvoiceBalance(
  rules: InvoicePricingRules,
  transactions: BalanceTransaction[],
  today: string,
): InvoiceBalance {
  // Confirmada sempre tem valor e data; só a que aguarda conferência fica sem
  const confirmed = transactions.filter(
    (row) =>
      row.status === TRANSACTION_STATUS.CONFIRMED &&
      row.amount != null &&
      row.occurredAt != null,
  );
  const payments = confirmed
    .filter((row) => row.type === TRANSACTION_TYPE.PAYMENT)
    .sort(byOccurrence);
  const refunds = confirmed.filter(
    (row) => row.type === TRANSACTION_TYPE.REFUND,
  );

  const totalPaid = sumAmounts(payments);
  const totalRefunded = sumAmounts(refunds);
  const net = totalPaid.minus(totalRefunded);

  let settlement = findSettlement(rules, payments);

  // Estornos que derrubam o recebido para baixo do devido desfazem a quitação
  if (settlement && net.lt(settlement.due)) settlement = null;

  const method = lockedMethod(transactions);
  const due = settlement
    ? settlement.due
    : method
      ? new Prisma.Decimal(getQuote(rules, method, today).total)
      : null;
  const excess = settlement
    ? Prisma.Decimal.max(net.minus(settlement.due), ZERO)
    : ZERO;

  return {
    totalPaid: toAmount(totalPaid),
    totalRefunded: toAmount(totalRefunded),
    net: toAmount(net),
    due: due ? toAmount(due) : null,
    balance: due ? toAmount(due.minus(net)) : null,
    excess: toAmount(excess),
    settledBy: settlement?.transaction ?? null,
  };
}

/**
 * Forma já usada para pagar a fatura: a do PAYMENT mais antigo confirmado ou aguardando
 * conferência. O pagamento manual trava a fatura nessa forma.
 */
export function lockedMethod(
  transactions: BalanceTransaction[],
): PaymentMethod | null {
  const [first] = transactions
    .filter(
      (row) =>
        row.type === TRANSACTION_TYPE.PAYMENT &&
        (row.status === TRANSACTION_STATUS.CONFIRMED ||
          row.status === TRANSACTION_STATUS.PENDING_REVIEW),
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return first ? (first.method as PaymentMethod) : null;
}

function findSettlement(
  rules: InvoicePricingRules,
  payments: BalanceTransaction[],
): Settlement | null {
  let accumulated = ZERO;

  for (const payment of payments) {
    const amount = payment.amount!;

    accumulated = accumulated.plus(amount);

    if (payment.source === TRANSACTION_SOURCE.GATEWAY) {
      return { transaction: payment, due: amount };
    }

    // Multa e juros contam até a data da parte que completou; o desconto vale se ela veio no prazo
    const dueOnDate = new Prisma.Decimal(
      getQuote(
        rules,
        payment.method as PaymentMethod,
        paidDate(payment.occurredAt!),
      ).total,
    );

    if (accumulated.gte(dueOnDate)) {
      return { transaction: payment, due: dueOnDate };
    }
  }

  return null;
}

/** Ordem do dinheiro: data em que entrou e, no mesmo instante, a ordem de registro. */
function byOccurrence(a: BalanceTransaction, b: BalanceTransaction): number {
  return (
    a.occurredAt!.getTime() - b.occurredAt!.getTime() ||
    a.createdAt.getTime() - b.createdAt.getTime()
  );
}

function sumAmounts(rows: BalanceTransaction[]): Prisma.Decimal {
  return rows.reduce((acc, row) => acc.plus(row.amount!), ZERO);
}

function toAmount(value: Prisma.Decimal): number {
  return roundCurrency(value.toNumber());
}
