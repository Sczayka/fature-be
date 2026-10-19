import { formatBRL, formatDateBR } from '../../common/utils/format.js';
import type { RenderedEmail } from '../email.types.js';
import {
  DetailRow,
  EmailItem,
  details,
  heading,
  items,
  paragraph,
  renderEmail,
} from './layout.js';
import { PayerContext, payerFooter } from './payer.js';

export interface QuoteEmailData {
  payer: PayerContext;
  clientName: string | null;
  description: string | null;
  items: EmailItem[];
  subtotal: number;
  itemsDiscount: number;
  total: number;
  /** YYYY-MM-DD; o orçamento pode não ter vencimento. */
  dueDate: string | null;
}

export function renderQuoteEmail(data: QuoteEmailData): RenderedEmail {
  const { organizationName } = data.payer;
  const rows: DetailRow[] = [
    ...(data.itemsDiscount > 0
      ? [
          { label: 'Subtotal', value: formatBRL(data.subtotal) },
          { label: 'Descontos', value: `- ${formatBRL(data.itemsDiscount)}` },
        ]
      : []),
    { label: 'Total', value: formatBRL(data.total) },
    ...(data.dueDate
      ? [{ label: 'Vencimento previsto', value: formatDateBR(data.dueDate) }]
      : []),
    ...(data.description
      ? [{ label: 'Descrição', value: data.description }]
      : []),
  ];
  const greeting = data.clientName ? `Olá, ${data.clientName}. ` : 'Olá. ';

  return renderEmail({
    brand: data.payer.brand,
    subject: `Orçamento de ${organizationName}`,
    preheader: `Orçamento de ${formatBRL(data.total)} preparado por ${organizationName}.`,
    blocks: [
      heading(`Orçamento de ${organizationName}`),
      paragraph(
        `${greeting}${organizationName} preparou um orçamento para você.`,
      ),
      items(data.items),
      details(rows),
      paragraph(
        data.payer.replyTo
          ? 'Para aprovar ou tirar dúvidas, responda este e-mail.'
          : `Para aprovar ou tirar dúvidas, fale com ${organizationName}.`,
      ),
    ],
    footer: payerFooter(
      data.payer,
      `Você recebeu este e-mail porque ${organizationName} enviou um orçamento para você pelo Fature.`,
    ),
  });
}
