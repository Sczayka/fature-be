import type { Prisma } from '@prisma/client';
import type { PaymentMethod } from '../payments.constants.js';

/** Sentido do dinheiro: PAYMENT entra, REFUND sai. O valor é sempre positivo. */
export const TRANSACTION_TYPE = {
  PAYMENT: 'PAYMENT',
  REFUND: 'REFUND',
} as const;

export type TransactionType =
  (typeof TRANSACTION_TYPE)[keyof typeof TRANSACTION_TYPE];

/** Só CONFIRMED entra no saldo da fatura. */
export const TRANSACTION_STATUS = {
  PENDING_REVIEW: 'PENDING_REVIEW',
  CONFIRMED: 'CONFIRMED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;

export type TransactionStatus =
  (typeof TRANSACTION_STATUS)[keyof typeof TRANSACTION_STATUS];

/** Quem registrou: o provedor (webhook ou cartão aprovado), o pagador (checkout) ou a empresa. */
export const TRANSACTION_SOURCE = {
  GATEWAY: 'GATEWAY',
  CHECKOUT: 'CHECKOUT',
  OPERATOR: 'OPERATOR',
} as const;

export type TransactionSource =
  (typeof TRANSACTION_SOURCE)[keyof typeof TRANSACTION_SOURCE];

/** Formas em que a devolução é feita por fora e registrada com comprovante. */
export const REFUND_METHODS = [
  'PIX',
  'BANK_TRANSFER',
] as const satisfies readonly PaymentMethod[];

export type RefundMethod = (typeof REFUND_METHODS)[number];

/** Campos lidos pelo cálculo do saldo (`computeInvoiceBalance`). */
export const BALANCE_TRANSACTION_SELECT = {
  id: true,
  type: true,
  status: true,
  source: true,
  method: true,
  amount: true,
  occurredAt: true,
  createdAt: true,
  chargeId: true,
} satisfies Prisma.InvoiceTransactionSelect;
