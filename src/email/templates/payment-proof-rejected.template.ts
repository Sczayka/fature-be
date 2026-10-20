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

export interface PaymentProofRejectedEmailData {
  payer: PayerContext;
  clientName: string;
  description: string | null;
  /** Motivo informado pela empresa na recusa. */
  reason: string;
  checkoutUrl: string | null;
}

export function renderPaymentProofRejectedEmail(
  data: PaymentProofRejectedEmailData,
): RenderedEmail {
  const { organizationName } = data.payer;
  const rows: DetailRow[] = [
    { label: 'Motivo', value: data.reason },
    ...(data.description
      ? [{ label: 'Descrição', value: data.description }]
      : []),
  ];

  return renderEmail({
    brand: data.payer.brand,
    subject: `Comprovante não aceito: fatura de ${organizationName}`,
    preheader: `${organizationName} não aceitou o comprovante enviado.`,
    blocks: [
      heading('Comprovante não aceito'),
      paragraph(
        `Olá, ${data.clientName}. ${organizationName} conferiu o comprovante que você enviou e não pôde aceitá-lo.`,
      ),
      details(rows),
      paragraph(
        'Se você já pagou, envie outro comprovante na página da fatura. Se ainda não pagou, a página mostra as formas de pagamento.',
      ),
      button('Enviar outro comprovante', data.checkoutUrl),
    ],
    footer: invoiceFooter(data.payer),
  });
}
