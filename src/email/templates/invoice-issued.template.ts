import { formatBRL, formatDateBR } from '../../common/utils/format.js';
import type { RenderedEmail } from '../email.types.js';
import {
  OpenInvoiceEmailData,
  invoiceFooter,
  openInvoiceDetails,
  paymentBlocks,
} from './invoice-content.js';
import { details, heading, items, paragraph, renderEmail } from './layout.js';

export function renderInvoiceIssuedEmail(
  data: OpenInvoiceEmailData,
): RenderedEmail {
  const { organizationName } = data.payer;
  const value = formatBRL(data.totalValue);
  const dueDate = formatDateBR(data.dueDate);

  return renderEmail({
    brand: data.payer.brand,
    subject: `${organizationName} enviou uma fatura de ${value} (vence em ${dueDate})`,
    preheader: `Fatura de ${value} com vencimento em ${dueDate}.`,
    blocks: [
      heading(`Nova fatura de ${organizationName}`),
      paragraph(
        `Olá, ${data.clientName}. ${organizationName} enviou uma fatura para você.`,
      ),
      details(openInvoiceDetails(data)),
      items(data.items),
      ...paymentBlocks(data),
    ],
    footer: invoiceFooter(data.payer),
  });
}
