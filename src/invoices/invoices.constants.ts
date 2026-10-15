export const PAYMENT_METHODS = [
  'BANK_SLIP',
  'CREDIT_CARD',
  'DEBIT_CARD',
  'PIX',
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const AMOUNT_TYPES = ['FIXED', 'PERCENTAGE'] as const;

export type AmountType = (typeof AMOUNT_TYPES)[number];

export const ITEM_TYPES = ['product', 'service'] as const;

export type ItemType = (typeof ITEM_TYPES)[number];

/** Fuso usado para comparar vencimento e datas limite de desconto. */
export const BILLING_TIMEZONE = 'America/Sao_Paulo';

/** Limite de caracteres da descrição de cobrança no Asaas. */
export const DESCRIPTION_MAX_LENGTH = 500;

export const DEFAULT_CHARGE_DESCRIPTION = 'Fatura gerada via Fature';
