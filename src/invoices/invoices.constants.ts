import type { PaymentMethod } from '../payments/payments.constants.js';

export { PAYMENT_METHODS } from '../payments/payments.constants.js';
export type { PaymentMethod };

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  BANK_SLIP: 'Boleto bancário',
  CREDIT_CARD: 'Cartão de crédito',
  DEBIT_CARD: 'Cartão de débito',
  PIX: 'PIX',
};

/** Caminho da página pública de pagamento no fature-fe: {FRONTEND_URL}/pagar/{checkoutToken}. */
export const CHECKOUT_PATH = '/pagar';

export const INVOICE_STATUS = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  OVERDUE: 'OVERDUE',
  CANCELLED: 'CANCELLED',
} as const;

export type InvoiceStatus =
  (typeof INVOICE_STATUS)[keyof typeof INVOICE_STATUS];

export const AMOUNT_TYPES = ['FIXED', 'PERCENTAGE'] as const;

export type AmountType = (typeof AMOUNT_TYPES)[number];

export const ITEM_TYPES = ['product', 'service'] as const;

export type ItemType = (typeof ITEM_TYPES)[number];

/** Fuso usado para comparar vencimento e datas limite de desconto. */
export const BILLING_TIMEZONE = 'America/Sao_Paulo';

/** Limite de caracteres da descrição de cobrança no Asaas. */
export const DESCRIPTION_MAX_LENGTH = 500;

export const DEFAULT_CHARGE_DESCRIPTION = 'Fatura gerada via Fature';
