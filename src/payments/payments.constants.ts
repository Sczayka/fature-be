/**
 * Métodos de pagamento do Fature. Cada adaptador traduz para os códigos do seu provedor.
 * BANK_TRANSFER não tem provedor: só é usada nas devoluções (movimentações da fatura).
 */
export const PAYMENT_METHODS = [
  'BANK_SLIP',
  'CREDIT_CARD',
  'DEBIT_CARD',
  'PIX',
  'BANK_TRANSFER',
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Situação da conta da organização em um provedor. */
export const GATEWAY_ACCOUNT_STATUS = {
  /** Criada no registro; o provedor só abre a conta depois dos dados da empresa. */
  AWAITING_COMPANY_INFO: 'AWAITING_COMPANY_INFO',
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  FAILED: 'FAILED',
} as const;

export type GatewayAccountStatus =
  (typeof GATEWAY_ACCOUNT_STATUS)[keyof typeof GATEWAY_ACCOUNT_STATUS];

export const CHARGE_STATUS = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
} as const;

export type ChargeStatus = (typeof CHARGE_STATUS)[keyof typeof CHARGE_STATUS];

/** Evento que abre a conta da organização no provedor (assíncrono). */
export const PAYMENT_ACCOUNT_ONBOARDING_EVENT =
  'payment-account.onboarding-requested';

/** Valor usado para comparar taxas fixas + percentuais entre provedores. */
export const DEFAULT_ROUTING_REFERENCE_AMOUNT = 100;

export function getRoutingReferenceAmount(): number {
  const value = Number(process.env.PAYMENT_ROUTING_REFERENCE_AMOUNT);

  return Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_ROUTING_REFERENCE_AMOUNT;
}
