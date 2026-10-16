import { INVOICE_STATUS, InvoiceStatus } from './invoices.constants.js';

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
