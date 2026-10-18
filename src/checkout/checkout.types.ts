import type { InvoiceStatus } from '../invoices/invoices.constants.js';
import type { Wallpaper } from '../organizations/customization/customization.constants.js';
import type { PaymentMethod } from '../payments/payments.constants.js';

/** Valor de hoje de um método, calculado pelo Fature (getQuote). */
export interface CheckoutQuote {
  total: number;
  phase: 'ON_TIME' | 'OVERDUE';
  nominalValue: number;
  methodDiscount: number;
  /** Até quando o desconto do método vale (null = sem desconto hoje). */
  discountUntil: string | null;
  fine: number;
  interest: number;
  daysLate: number;
}

export interface CheckoutPix {
  value: number;
  /** Último dia em que este QR Code tem o valor certo. */
  validUntil: string;
  payload: string;
  qrCodeImage: string;
  expiresAt: string | null;
}

export interface CheckoutBankSlip {
  url: string | null;
  identificationField: string | null;
}

/** Como o cartão é capturado no navegador: formulário do Fature ou SDK do provedor. */
export type CheckoutCardCapture =
  { mode: 'RAW' } | { mode: 'PROVIDER_TOKEN'; provider: string };

export type CheckoutOption =
  | { method: 'BANK_SLIP'; quote: CheckoutQuote; bankSlip: CheckoutBankSlip }
  | { method: 'PIX'; quote: CheckoutQuote; pix: CheckoutPix | null }
  | {
      method: 'CREDIT_CARD';
      quote: CheckoutQuote;
      cardCapture: CheckoutCardCapture;
    };

export interface CheckoutPayment {
  paidAt: string;
  method: PaymentMethod | null;
  value: number | null;
}

/** Personalização da organização (aba Customização); null = padrão do Fature. */
export interface CheckoutTheme {
  wallpaper: Wallpaper | null;
  backgroundColor: string | null;
  buttonColor: string | null;
}

/** Fatura como o pagador a vê: sem dados pessoais além do nome nem dados do provedor. */
export interface CheckoutView {
  status: InvoiceStatus;
  issuer: { name: string; logo: string | null };
  theme: CheckoutTheme;
  customerName: string;
  description: string | null;
  dueDate: string;
  /** `total` é o valor original do item; `discount` (R$) é o que o desconto do item abate (0 = sem desconto). */
  items: Array<{
    name: string;
    quantity: number;
    total: number;
    discount: number;
  }>;
  nominalValue: number;
  payment: CheckoutPayment | null;
  options: CheckoutOption[];
}

export interface CheckoutStatus {
  status: InvoiceStatus;
  paidAt: string | null;
  paidMethod: PaymentMethod | null;
}

export interface CardPaymentResult {
  status: 'PAID' | 'IN_ANALYSIS';
}
