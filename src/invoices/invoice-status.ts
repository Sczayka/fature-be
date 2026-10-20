import type { Prisma } from '@prisma/client';
import { INVOICE_STATUS, InvoiceStatus } from './invoices.constants.js';
import { utcMidnight } from './pricing/dates.js';

/**
 * Status exibido: fatura pendente com o vencimento passado aparece como vencida, mesmo sem
 * evento do provedor (faturas sem boleto nunca recebem um). `today` no formato YYYY-MM-DD.
 */
export function displayInvoiceStatus(
  status: string,
  dueDate: Date,
  today: string,
): InvoiceStatus {
  // dueDate é gravado à meia-noite UTC: a comparação usa só a data
  const isOverdue = dueDate.toISOString().slice(0, 10) < today;

  return status === INVOICE_STATUS.PENDING && isOverdue
    ? INVOICE_STATUS.OVERDUE
    : (status as InvoiceStatus);
}

/**
 * Filtro pelo status exibido, com a mesma regra de `displayInvoiceStatus`: pendente é a que ainda
 * não venceu, e vencida inclui a pendente com o vencimento passado. `today` no formato YYYY-MM-DD.
 */
export function invoiceStatusWhere(
  status: InvoiceStatus,
  today: string,
): Prisma.InvoiceWhereInput {
  const startOfToday = utcMidnight(today);

  switch (status) {
    case INVOICE_STATUS.PENDING:
      return {
        status: INVOICE_STATUS.PENDING,
        dueDate: { gte: startOfToday },
      };
    case INVOICE_STATUS.OVERDUE:
      return {
        OR: [
          { status: INVOICE_STATUS.OVERDUE },
          { status: INVOICE_STATUS.PENDING, dueDate: { lt: startOfToday } },
        ],
      };
    default:
      return { status };
  }
}
