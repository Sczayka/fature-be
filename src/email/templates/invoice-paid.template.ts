import { formatBRL, formatDateBR } from '../../common/utils/format.js';
import type { RenderedEmail } from '../email.types.js';
import { invoiceFooter } from './invoice-content.js';
import {
  DetailRow,
  button,
  details,
  heading,
  paragraph,
  renderEmail,
} from './layout.js';
import type { PayerContext } from './payer.js';

export interface InvoicePaidEmailData {
  payer: PayerContext;
  clientName: string;
  description: string | null;
  /** YYYY-MM-DD */
  paidAt: string;
  paidValue: number;
  methodLabel: string | null;
  receiptUrl: string | null;
  checkoutUrl: string | null;
}

export function renderInvoicePaidEmail(
  data: InvoicePaidEmailData,
): RenderedEmail {
  const { organizationName } = data.payer;
  const rows: DetailRow[] = [
    { label: 'Valor pago', value: formatBRL(data.paidValue) },
    { label: 'Data do pagamento', value: formatDateBR(data.paidAt) },
    ...(data.methodLabel
      ? [{ label: 'Forma de pagamento', value: data.methodLabel }]
      : []),
    ...(data.description
      ? [{ label: 'Descrição', value: data.description }]
      : []),
  ];

  return renderEmail({
    brand: data.payer.brand,
    subject: `Pagamento confirmado: fatura de ${organizationName}`,
    preheader: `Recebemos o pagamento de ${formatBRL(data.paidValue)}.`,
    blocks: [
      heading('Pagamento confirmado'),
      paragraph(
        `Olá, ${data.clientName}. O pagamento da sua fatura de ${organizationName} foi confirmado. Obrigado!`,
      ),
      details(rows),
      // Sem comprovante do provedor, a página da fatura mostra o pagamento
      data.receiptUrl
        ? button('Ver comprovante', data.receiptUrl)
        : button('Ver fatura', data.checkoutUrl),
    ],
    footer: invoiceFooter(data.payer),
  });
}
