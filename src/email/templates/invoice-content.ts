import { formatBRL, formatDateBR } from '../../common/utils/format.js';
import {
  DetailRow,
  EmailBlock,
  EmailItem,
  button,
  code,
  link,
  paragraph,
} from './layout.js';
import { PayerContext, payerFooter } from './payer.js';

/** Preço promocional de uma forma de pagamento (desconto até uma data). */
export interface PaymentOffer {
  methodLabel: string;
  total: number;
  until: string;
}

export interface BankSlipInfo {
  identificationField: string | null;
  url: string | null;
}

/** Fatura em aberto, como aparece nos e-mails de emissão e de lembrete. */
export interface OpenInvoiceEmailData {
  payer: PayerContext;
  clientName: string;
  description: string | null;
  items: EmailItem[];
  totalValue: number;
  /** YYYY-MM-DD */
  dueDate: string;
  paymentMethodLabels: string[];
  offers: PaymentOffer[];
  checkoutUrl: string | null;
  bankSlip: BankSlipInfo | null;
}

export function openInvoiceDetails(data: OpenInvoiceEmailData): DetailRow[] {
  return [
    { label: 'Valor', value: formatBRL(data.totalValue) },
    { label: 'Vencimento', value: formatDateBR(data.dueDate) },
    ...(data.description
      ? [{ label: 'Descrição', value: data.description }]
      : []),
    ...(data.paymentMethodLabels.length > 0
      ? [
          {
            label: 'Formas de pagamento',
            value: data.paymentMethodLabels.join(', '),
          },
        ]
      : []),
  ];
}

/** Descontos por forma de pagamento, botão para pagar e o boleto. */
export function paymentBlocks(data: OpenInvoiceEmailData): EmailBlock[] {
  const offers = data.offers.map((offer) =>
    paragraph(
      `Pagando com ${offer.methodLabel} até ${formatDateBR(offer.until)}, o valor cai para ${formatBRL(offer.total)}.`,
    ),
  );
  const blocks: Array<EmailBlock | null> = [
    ...offers,
    button('Ver fatura e pagar', data.checkoutUrl),
    data.bankSlip?.identificationField
      ? code('Linha digitável do boleto', data.bankSlip.identificationField)
      : null,
    link('Baixar o boleto', data.bankSlip?.url ?? null),
  ];

  return blocks.filter((block): block is EmailBlock => block !== null);
}

export function invoiceFooter(payer: PayerContext): string[] {
  return payerFooter(
    payer,
    `Você recebeu este e-mail porque ${payer.organizationName} emitiu uma cobrança para você pelo Fature.`,
  );
}
