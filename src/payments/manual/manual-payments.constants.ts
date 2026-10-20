import type { PaymentMethod } from '../payments.constants.js';

/**
 * Como o PIX da organização é atendido: pelo provedor (QR Code com taxa) ou com a chave da empresa
 * e o comprovante (sem taxa). Só muda pelo script payments:pix-mode, que cancela os PIX abertos.
 */
export const PIX_MODE = {
  AUTOMATIC: 'AUTOMATIC',
  MANUAL: 'MANUAL',
} as const;

export type PixMode = (typeof PIX_MODE)[keyof typeof PIX_MODE];

/** Formas pagas por fora do Fature, com o comprovante conferido pela empresa. */
export const MANUAL_PAYMENT_METHODS = [
  'BANK_TRANSFER',
  'PIX',
] as const satisfies readonly PaymentMethod[];

export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];

export const isManualPaymentMethod = (
  method: string | null,
): method is ManualPaymentMethod =>
  MANUAL_PAYMENT_METHODS.includes(method as ManualPaymentMethod);

/** O cadastro da empresa não tem cidade. O BR Code exige o campo, mas os bancos não o validam. */
export const PIX_MERCHANT_CITY = 'BRASIL';

/** Copia e cola sem identificador: o pagamento é conferido pelo comprovante. */
export const PIX_STATIC_TXID = '***';

/** Comprovantes aguardando conferência por fatura. */
export const MAX_PENDING_RECEIPTS = 10;
