import { formatBRL, formatDateBR } from '../../common/utils/format.js';
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

export interface InvoiceOverdueEmailData {
  payer: PayerContext;
  clientName: string;
  description: string | null;
  totalValue: number;
  /** YYYY-MM-DD */
  dueDate: string;
  /** Valor para pagar hoje, com multa e juros. */
  amountToday: number;
  checkoutUrl: string | null;
}

export function renderInvoiceOverdueEmail(
  data: InvoiceOverdueEmailData,
): RenderedEmail {
  const { organizationName } = data.payer;
  const dueDate = formatDateBR(data.dueDate);
  const rows: DetailRow[] = [
    { label: 'Valor original', value: formatBRL(data.totalValue) },
    { label: 'Vencimento', value: dueDate },
    ...(data.amountToday > data.totalValue
      ? [
          {
            label: 'Valor para pagar hoje (com multa e juros)',
            value: formatBRL(data.amountToday),
          },
        ]
      : []),
    ...(data.description
      ? [{ label: 'Descrição', value: data.description }]
      : []),
  ];

  return renderEmail({
    brand: data.payer.brand,
    subject: `Fatura de ${organizationName} vencida em ${dueDate}`,
    preheader: `A fatura de ${formatBRL(data.totalValue)} venceu em ${dueDate}.`,
    blocks: [
      heading('Fatura vencida'),
      paragraph(
        `Olá, ${data.clientName}. A fatura de ${organizationName} venceu em ${dueDate} e ainda não consta como paga.`,
      ),
      details(rows),
      button('Pagar agora', data.checkoutUrl),
      note('Se você já pagou, desconsidere este aviso.'),
    ],
    footer: invoiceFooter(data.payer),
  });
}
