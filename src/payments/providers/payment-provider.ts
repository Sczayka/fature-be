import type { PaymentMethod } from '../payments.constants.js';

/**
 * Porta dos provedores de pagamento. Só os adaptadores conhecem um provedor; o restante do
 * Fature fala com o núcleo (roteamento, cobranças, clientes e eventos), que usa esta porta.
 */

/** Como o checkout captura o cartão: pelo formulário do Fature (RAW) ou por tokenização do provedor no navegador. */
export type CardCaptureMode = 'RAW' | 'PROVIDER_TOKEN';

export interface ProviderCapabilities {
  methods: readonly PaymentMethod[];
  cardCapture: CardCaptureMode | null;
  supportsSplit: boolean;
}

/** Conta da organização no provedor, como gravada em PaymentGatewayAccount. */
export interface GatewayAccountRef {
  id: string;
  provider: string;
  accountId: string;
  metadata: unknown;
}

/** Dados da empresa usados para abrir a conta no provedor. */
export interface OrganizationProfile {
  id: string;
  name: string;
  cnpj: string;
  companyType: string | null;
  phone: string | null;
  mobilePhone: string | null;
  incomeValue: number | null;
  address: string | null;
  addressNumber: string | null;
  complement: string | null;
  province: string | null;
  postalCode: string | null;
}

export interface CreatedGatewayAccount {
  accountId: string;
  /** Gravado em PaymentGatewayAccount.metadata, com as credenciais já cifradas. */
  metadata: Record<string, unknown>;
}

/** Cliente da organização, como cadastrado no Fature. */
export interface CustomerProfile {
  name: string;
  cpfCnpj: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  cep: string | null;
  addressLine: string | null;
  addressNumber: string | null;
  complement: string | null;
  district: string | null;
  municipalInscription: string | null;
  stateInscription: string | null;
}

export interface ProviderCustomer {
  externalId: string;
  metadata: Record<string, unknown>;
}

interface ChargeInputBase {
  customerExternalId: string;
  value: number;
  /** YYYY-MM-DD */
  dueDate: string;
  description: string;
  /** Referência do Fature (InvoiceCharge.id): permite achar a cobrança no provedor após uma falha. */
  reference: string;
  /** Margem do Fature enviada por split (0 = sem split). */
  splitAmount: number;
}

export interface BankSlipChargeInput extends ChargeInputBase {
  method: 'BANK_SLIP';
  /** Desconto em R$ válido até `until` (YYYY-MM-DD, inclusive), aplicado pelo provedor. */
  discount: { value: number; until: string } | null;
  /** Multa em R$. */
  fine: number;
  /** Juros em % ao mês. */
  interestPercent: number;
}

/** Cobrança com valor fechado pelo Fature: sem desconto, multa ou juros do provedor. */
export interface PixChargeInput extends ChargeInputBase {
  method: 'PIX';
}

export interface RawCardData {
  holderName: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
}

export interface CardHolder {
  name: string;
  email: string;
  cpfCnpj: string;
  postalCode: string;
  addressNumber: string;
  phone: string;
}

export type CardPayment =
  | { mode: 'RAW'; card: RawCardData; holder: CardHolder }
  | { mode: 'PROVIDER_TOKEN'; token: string; holder: CardHolder };

export interface CreditCardChargeInput extends ChargeInputBase {
  method: 'CREDIT_CARD';
  payment: CardPayment;
  /** IP do pagador (antifraude do provedor). */
  payerIp: string;
}

export type CreateChargeInput =
  BankSlipChargeInput | PixChargeInput | CreditCardChargeInput;

/** Dados que o pagador vê, gravados em InvoiceCharge.details. */
export interface ChargeDetails {
  invoiceUrl: string | null;
  bankSlipUrl: string | null;
  /** Linha digitável do boleto. */
  identificationField: string | null;
  /** PIX copia e cola. */
  pixPayload: string | null;
  /** QR Code do PIX em PNG base64. */
  pixQrCodeImage: string | null;
  pixExpiresAt: string | null;
  receiptUrl: string | null;
}

export type ProviderChargeStatus = 'PENDING' | 'PAID' | 'IN_ANALYSIS';

export interface ProviderCharge {
  externalId: string;
  status: ProviderChargeStatus;
  details: ChargeDetails;
  raw: unknown;
}

export type PaymentEventType =
  | 'CHARGE_PAID'
  | 'CHARGE_OVERDUE'
  | 'CHARGE_CANCELLED'
  | 'CHARGE_REFUNDED'
  | 'CHARGE_FAILED'
  | 'IGNORED';

/** Evento de webhook já autenticado e normalizado pelo adaptador. */
export interface PaymentEvent {
  externalEventId: string;
  type: PaymentEventType;
  /** Nome do evento no provedor, para registro. */
  providerType: string;
  chargeExternalId: string | null;
  paidAt: string | null;
  paidValue: number | null;
  /** Dia (YYYY-MM-DD) em que o provedor credita o pagamento na conta: previsto, até o crédito. */
  creditDate: string | null;
  /** Comprovante do pagamento, quando o provedor já o gerou. */
  receiptUrl: string | null;
  raw: unknown;
}

export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  rawBody: Buffer;
}

export interface PaymentProvider {
  readonly code: string;
  readonly capabilities: ProviderCapabilities;

  createAccount(
    organization: OrganizationProfile,
  ): Promise<CreatedGatewayAccount>;
  /** Ajustes depois que a conta existe (webhook, chave PIX...). Idempotente: devolve o metadata atualizado. */
  onboardAccount(account: GatewayAccountRef): Promise<Record<string, unknown>>;

  createCustomer(
    account: GatewayAccountRef,
    customer: CustomerProfile,
  ): Promise<ProviderCustomer>;
  updateCustomer(
    account: GatewayAccountRef,
    externalId: string,
    customer: CustomerProfile,
  ): Promise<void>;
  deleteCustomer(account: GatewayAccountRef, externalId: string): Promise<void>;

  createCharge(
    account: GatewayAccountRef,
    input: CreateChargeInput,
  ): Promise<ProviderCharge>;
  cancelCharge(account: GatewayAccountRef, externalId: string): Promise<void>;
  findChargesByReference(
    account: GatewayAccountRef,
    reference: string,
  ): Promise<ProviderCharge[]>;

  /** Autentica a chamada (lança PaymentProviderError UNAUTHORIZED) e normaliza os eventos. */
  parseWebhook(request: WebhookRequest): PaymentEvent[];

  /** Saldo disponível da conta da organização no provedor, para conferir com o caixa. */
  getBalance(account: GatewayAccountRef): Promise<number>;
}

export type PaymentProviderErrorKind =
  'INVALID_DATA' | 'CARD_REFUSED' | 'UNAVAILABLE' | 'UNAUTHORIZED';

/** Erro tratado de um provedor. Em INVALID_DATA e CARD_REFUSED, a mensagem pode ser exibida. */
export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly kind: PaymentProviderErrorKind,
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}
