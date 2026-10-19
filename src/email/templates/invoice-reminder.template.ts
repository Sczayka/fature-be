import { formatBRL, formatDateBR } from '../../common/utils/format.js';
import type { RenderedEmail } from '../email.types.js';
import {
  OpenInvoiceEmailData,
  invoiceFooter,
  openInvoiceDetails,
  paymentBlocks,
} from './invoice-content.js';
import { details, heading, note, paragraph, renderEmail } from './layout.js';

export interface InvoiceReminderEmailData extends OpenInvoiceEmailData {
  daysUntilDue: number;
}

function dueIn(days: number): string {
  if (days <= 0) return 'vence hoje';
  if (days === 1) return 'vence amanhã';

  return `vence em ${days} dias`;
}

export function renderInvoiceReminderEmail(
  data: InvoiceReminderEmailData,
): RenderedEmail {
  const { organizationName } = data.payer;
  const dueDate = formatDateBR(data.dueDate);

  return renderEmail({
    brand: data.payer.brand,
    subject: `Lembrete: sua fatura de ${organizationName} vence em ${dueDate}`,
    preheader: `Fatura de ${formatBRL(data.totalValue)}: ${dueIn(data.daysUntilDue)}.`,
    blocks: [
      heading(`Sua fatura ${dueIn(data.daysUntilDue)}`),
      paragraph(
        `Olá, ${data.clientName}. Este é um lembrete da fatura de ${organizationName} com vencimento em ${dueDate}.`,
      ),
      details(openInvoiceDetails(data)),
      ...paymentBlocks(data),
      note('Se você já pagou, desconsidere este lembrete.'),
    ],
    footer: invoiceFooter(data.payer),
  });
}
