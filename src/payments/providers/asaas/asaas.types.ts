/** Contratos da API v3 do Asaas usados pelo adaptador. */

export interface AsaasSubaccountRequest {
  name: string;
  email: string;
  cpfCnpj: string;
  companyType?: string;
  phone?: string;
  mobilePhone?: string;
  incomeValue?: number;
  address?: string;
  addressNumber?: string;
  complement?: string;
  province?: string;
  postalCode?: string;
}

export interface AsaasSubaccount {
  id: string;
  name: string;
  email: string;
  walletId: string;
  apiKey: string;
  [key: string]: unknown;
}

export interface AsaasCustomerRequest {
  name?: string;
  cpfCnpj?: string;
  email?: string;
  phone?: string;
  mobilePhone?: string;
  address?: string;
  addressNumber?: string;
  complement?: string;
  province?: string;
  postalCode?: string;
  municipalInscription?: string;
  stateInscription?: string;
  /** O pagador recebe só o link do Fature, sem as notificações do Asaas. */
  notificationDisabled?: boolean;
}

export interface AsaasCustomer {
  id: string;
  name: string;
  cpfCnpj: string;
  [key: string]: unknown;
}

export interface AsaasPaymentRequest {
  customer: string;
  billingType: string;
  value: number;
  dueDate: string;
  description?: string;
  externalReference?: string;
  discount?: {
    value: number;
    dueDateLimitDays: number;
    type: 'FIXED' | 'PERCENTAGE';
  };
  interest?: { value: number };
  fine?: { value: number; type: 'FIXED' | 'PERCENTAGE' };
  split?: Array<{
    walletId: string;
    fixedValue?: number;
    percentualValue?: number;
  }>;
  creditCard?: {
    holderName: string;
    number: string;
    expiryMonth: string;
    expiryYear: string;
    ccv: string;
  };
  creditCardHolderInfo?: {
    name: string;
    email: string;
    cpfCnpj: string;
    postalCode: string;
    addressNumber: string;
    phone: string;
    mobilePhone?: string;
  };
  creditCardToken?: string;
  remoteIp?: string;
}

export interface AsaasPayment {
  object: string;
  id: string;
  customer: string;
  value: number;
  netValue: number;
  description: string;
  billingType: string;
  status: string;
  dueDate: string;
  externalReference: string | null;
  invoiceUrl: string | null;
  bankSlipUrl?: string | null;
  transactionReceiptUrl?: string | null;
  paymentDate?: string | null;
  confirmedDate?: string | null;
  clientPaymentDate?: string | null;
  deleted: boolean;
  [key: string]: unknown;
}

export interface AsaasList<T> {
  object: 'list';
  hasMore: boolean;
  totalCount: number;
  limit: number;
  offset: number;
  data: T[];
}

export interface AsaasPixQrCode {
  encodedImage: string;
  payload: string;
  expirationDate: string;
}

export interface AsaasIdentificationField {
  identificationField: string;
  nossoNumero: string;
  barCode: string;
}

export interface AsaasWebhookRequest {
  name: string;
  url: string;
  email?: string;
  enabled: boolean;
  interrupted: boolean;
  apiVersion: number;
  authToken: string;
  sendType: 'SEQUENTIALLY' | 'NON_SEQUENTIALLY';
  events: string[];
}

export interface AsaasWebhook {
  id: string;
  [key: string]: unknown;
}

export interface AsaasPixKey {
  id: string;
  key: string;
  type: string;
  status: string;
}

export interface AsaasWebhookEvent {
  id: string;
  event: string;
  dateCreated: string;
  payment?: AsaasPayment;
  [key: string]: unknown;
}
