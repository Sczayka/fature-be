import type { PaymentMethod } from '../../payments.constants.js';
import type { ProviderCapabilities } from '../payment-provider.js';

export const ASAAS_PROVIDER = 'ASAAS';

/** Débito não é aceito pela API do Asaas (só na página hospedada), então fica de fora. */
export const ASAAS_CAPABILITIES: ProviderCapabilities = {
  methods: ['BANK_SLIP', 'PIX', 'CREDIT_CARD'],
  cardCapture: 'RAW',
  supportsSplit: true,
};

export const ASAAS_BILLING_TYPES: Partial<Record<PaymentMethod, string>> = {
  BANK_SLIP: 'BOLETO',
  PIX: 'PIX',
  CREDIT_CARD: 'CREDIT_CARD',
};

/** Chamadas de cartão podem demorar: o Asaas autoriza a transação antes de responder. */
export const ASAAS_REQUEST_TIMEOUT_MS = 60_000;

export const ASAAS_WEBHOOK_EVENTS = [
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED',
  'PAYMENT_OVERDUE',
  'PAYMENT_DELETED',
  'PAYMENT_REFUNDED',
  'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
  'PAYMENT_REPROVED_BY_RISK_ANALYSIS',
];

export const ASAAS_PAID_STATUSES = [
  'CONFIRMED',
  'RECEIVED',
  'RECEIVED_IN_CASH',
];
