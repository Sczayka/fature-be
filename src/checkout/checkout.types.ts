import type { InvoiceStatus } from '../invoices/invoices.constants.js';
import type { Wallpaper } from '../organizations/customization/customization.constants.js';
import type { ManualPaymentMethod } from '../payments/manual/manual-payments.constants.js';
import type { PaymentMethod } from '../payments/payments.constants.js';
import type { TransactionStatus } from '../payments/transactions/transactions.constants.js';
import type {
  BankAccountType,
  PixKeyType,
} from '../suppliers/suppliers.constants.js';

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

/** Conta da empresa para a transferência (aba Dados bancários). */
export interface CheckoutBankTransfer {
  bankCode: string;
  bankName: string | null;
  branch: string;
  accountNumber: string;
  accountType: BankAccountType;
  holderName: string;
  holderDocument: string;
  /** Valor a transferir hoje: o saldo, quando já há pagamento confirmado. */
  value: number;
}

/** PIX com a chave da empresa: copia e cola estático, sem provedor. */
export interface CheckoutManualPix {
  keyType: PixKeyType;
  key: string;
  holderName: string;
  /** Saldo a pagar hoje, já embutido no copia e cola. */
  value: number;
  payload: string;
  qrCodeImage: string;
}

export type CheckoutOption =
  | { method: 'BANK_SLIP'; quote: CheckoutQuote; bankSlip: CheckoutBankSlip }
  | {
      method: 'PIX';
      mode: 'AUTOMATIC';
      quote: CheckoutQuote;
      pix: CheckoutPix | null;
    }
  | {
      method: 'PIX';
      mode: 'MANUAL';
      quote: CheckoutQuote;
      manualPix: CheckoutManualPix;
    }
  | {
      method: 'BANK_TRANSFER';
      quote: CheckoutQuote;
      bankTransfer: CheckoutBankTransfer;
    }
  | {
      method: 'CREDIT_CARD';
      quote: CheckoutQuote;
      cardCapture: CheckoutCardCapture;
    };

/** Comprovante do pagamento manual, enviado pelo pagador ou lançado pela empresa. */
export interface CheckoutReceipt {
  id: string;
  method: ManualPaymentMethod;
  status: TransactionStatus;
  /** Valor confirmado pela empresa; null enquanto aguarda conferência. */
  amount: number | null;
  /** YYYY-MM-DD; null enquanto aguarda conferência. */
  occurredAt: string | null;
  /** Motivo da recusa. */
  statusReason: string | null;
  /** Só no enviado pelo pagador: o arquivo da empresa não abre no checkout. */
  fileName: string | null;
  createdAt: string;
}

/** Quanto já entrou pelo pagamento manual e quanto falta hoje. */
export interface CheckoutBalance {
  /** null sem forma definida (nenhum pagamento ainda). */
  due: number | null;
  received: number;
  /** due - received; null quando due é null. */
  balance: number | null;
}

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
  /** Só as de origem CHECKOUT e OPERATOR (nunca as do provedor). */
  receipts: CheckoutReceipt[];
  balance: CheckoutBalance;
  /** Forma manual já usada: o checkout só aceita ela. */
  lockedMethod: ManualPaymentMethod | null;
}

export interface CheckoutStatus {
  status: InvoiceStatus;
  paidAt: string | null;
  paidMethod: PaymentMethod | null;
}

export interface CardPaymentResult {
  status: 'PAID' | 'IN_ANALYSIS';
}
