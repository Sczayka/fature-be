import { formatBRL } from '../../common/utils/format.js';
import type { RenderedEmail } from '../email.types.js';
import { invoiceFooter } from './invoice-content.js';
import {
  DetailRow,
  button,
  details,
  heading,
  note,
  paragraph,
  renderEmail,
} from './layout.js';
import type { PayerContext } from './payer.js';

export interface InvoicePartiallyPaidEmailData {
  payer: PayerContext;
  clientName: string;
  description: string | null;
  /** Pagamento que a empresa acabou de confirmar. */
  amount: number;
  /** Tudo o que já entrou pela fatura. */
  received: number;
  /** Saldo a pagar hoje. */
  balance: number;
  checkoutUrl: string | null;
}

export function renderInvoicePartiallyPaidEmail(
  data: InvoicePartiallyPaidEmailData,
): RenderedEmail {
  const { organizationName } = data.payer;
  const rows: DetailRow[] = [
    { label: 'Valor recebido', value: formatBRL(data.amount) },
    ...(data.received > data.amount
      ? [{ label: 'Total recebido', value: formatBRL(data.received) }]
      : []),
    { label: 'Falta pagar hoje', value: formatBRL(data.balance) },
    ...(data.description
      ? [{ label: 'Descrição', value: data.description }]
      : []),
  ];

  return renderEmail({
    brand: data.payer.brand,
    subject: `Pagamento parcial recebido: fatura de ${organizationName}`,
    preheader: `Recebemos ${formatBRL(data.amount)}. Falta pagar ${formatBRL(data.balance)}.`,
    blocks: [
      heading('Pagamento parcial recebido'),
      paragraph(
        `Olá, ${data.clientName}. ${organizationName} confirmou o recebimento de ${formatBRL(data.amount)}, mas o valor não cobre a fatura.`,
      ),
      details(rows),
      button('Pagar o restante', data.checkoutUrl),
      note(
        'O saldo é o valor de hoje e pode mudar com o fim do desconto ou, depois do vencimento, com multa e juros.',
      ),
    ],
    footer: invoiceFooter(data.payer),
  });
}
