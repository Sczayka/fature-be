import type { Prisma } from '@prisma/client';
import { INVOICE_STATUS, InvoiceStatus } from './invoices.constants.js';
import { utcMidnight } from './pricing/dates.js';

/**
 * Em aberto, sem pagamento confirmado: a data decide se está pendente ou vencida. O OVERDUE
 * gravado pelo provedor não vale sozinho: o PIX do checkout vence no fim do desconto, que pode
 * ser antes do vencimento da fatura.
 */
const UNPAID_STATUSES: string[] = [
  INVOICE_STATUS.PENDING,
  INVOICE_STATUS.OVERDUE,
];

/**
 * Status exibido: fatura em aberto com o vencimento passado aparece como vencida, mesmo sem
 * evento do provedor (faturas sem boleto nunca recebem um), e a marcada como vencida antes do
 * vencimento aparece como pendente. `today` no formato YYYY-MM-DD.
 */
export function displayInvoiceStatus(
  status: string,
  dueDate: Date,
  today: string,
): InvoiceStatus {
  if (!UNPAID_STATUSES.includes(status)) return status as InvoiceStatus;

  // dueDate é gravado à meia-noite UTC: a comparação usa só a data
  return dueDate.toISOString().slice(0, 10) < today
    ? INVOICE_STATUS.OVERDUE
    : INVOICE_STATUS.PENDING;
}

/**
 * Filtro pelo status exibido, com a mesma regra de `displayInvoiceStatus`: pendente é a em aberto
 * que ainda não venceu, e vencida é a em aberto com o vencimento passado. `today` no formato
 * YYYY-MM-DD.
 */
export function invoiceStatusWhere(
  status: InvoiceStatus,
  today: string,
): Prisma.InvoiceWhereInput {
  const startOfToday = utcMidnight(today);

  switch (status) {
    case INVOICE_STATUS.PENDING:
      return {
        status: { in: UNPAID_STATUSES },
        dueDate: { gte: startOfToday },
      };
    case INVOICE_STATUS.OVERDUE:
      return {
        status: { in: UNPAID_STATUSES },
        dueDate: { lt: startOfToday },
      };
    default:
      return { status };
  }
}

/**
 * A receber: as pendentes que ainda não venceram e as que aguardam a conferência de um
 * comprovante (de qualquer vencimento). `today` no formato YYYY-MM-DD.
 */
export function receivableInvoicesWhere(
  today: string,
): Prisma.InvoiceWhereInput {
  return {
    OR: [
      invoiceStatusWhere(INVOICE_STATUS.PENDING, today),
      { status: INVOICE_STATUS.AWAITING_CONFIRMATION },
    ],
  };
}
