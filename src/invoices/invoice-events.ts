/**
 * Eventos da fatura, emitidos depois que a gravação foi confirmada (fora das transações). Hoje
 * alimentam os e-mails ao pagador; nota fiscal e financeiro podem ouvir os mesmos. O estoque não
 * ouve: a baixa é gravada na emissão, na transação que grava a fatura.
 */
export const INVOICE_ISSUED_EVENT = 'invoice.issued';
export const INVOICE_PAID_EVENT = 'invoice.paid';
/** Pagamento manual: o pagador enviou um comprovante (aviso à empresa). */
export const PAYMENT_PROOF_RECEIVED_EVENT = 'invoice.payment-proof.received';
/** Pagamento manual: a empresa recusou o comprovante (aviso ao pagador). */
export const PAYMENT_PROOF_REJECTED_EVENT = 'invoice.payment-proof.rejected';
/** Pagamento manual confirmado que não cobriu a fatura, sem outro comprovante a conferir. */
export const INVOICE_PARTIALLY_PAID_EVENT = 'invoice.partially-paid';

export interface InvoiceIssuedEvent {
  invoiceId: string;
  organizationId: string;
}

export interface InvoicePaidEvent {
  invoiceId: string;
  organizationId: string;
  /** Transação (InvoiceTransaction) que quitou a fatura. */
  transactionId: string;
  /** null no pagamento manual, que não tem cobrança no provedor. */
  chargeId: string | null;
  method: string;
  /** ISO 8601 */
  paidAt: string;
  paidValue: number;
}

/** Comprovante recebido ou recusado e pagamento parcial: a transação que motivou o aviso. */
export interface InvoiceTransactionEvent {
  invoiceId: string;
  organizationId: string;
  transactionId: string;
}
