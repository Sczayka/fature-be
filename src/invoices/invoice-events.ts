/**
 * Eventos da fatura, emitidos depois que a gravação foi confirmada (fora das transações). Hoje
 * alimentam os e-mails ao pagador; estoque, nota fiscal e financeiro podem ouvir os mesmos.
 */
export const INVOICE_ISSUED_EVENT = 'invoice.issued';
export const INVOICE_PAID_EVENT = 'invoice.paid';

export interface InvoiceIssuedEvent {
  invoiceId: string;
  organizationId: string;
}

export interface InvoicePaidEvent {
  invoiceId: string;
  organizationId: string;
  chargeId: string;
  method: string;
  /** ISO 8601 */
  paidAt: string;
  paidValue: number;
}
