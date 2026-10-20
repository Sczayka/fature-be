import { formatBRL, formatDateBR } from '../../common/utils/format.js';
import type { RenderedEmail } from '../email.types.js';
import type { EmailBrand } from './brand.js';
import {
  DetailRow,
  button,
  details,
  heading,
  note,
  paragraph,
  renderEmail,
} from './layout.js';

/** Aviso à empresa: o pagador enviou um comprovante do pagamento manual para conferir. */
export interface PaymentProofReceivedEmailData {
  brand: EmailBrand;
  clientName: string;
  description: string | null;
  methodLabel: string;
  /** Valor de hoje da fatura na forma do comprovante. */
  amountToday: number;
  /** Já confirmado em comprovantes anteriores (0 = nenhum). */
  received: number;
  /** YYYY-MM-DD */
  dueDate: string;
  /** Detalhe da fatura no Fature, onde o comprovante é conferido. */
  invoiceUrl: string;
}

export function renderPaymentProofReceivedEmail(
  data: PaymentProofReceivedEmailData,
): RenderedEmail {
  const rows: DetailRow[] = [
    { label: 'Cliente', value: data.clientName },
    { label: 'Forma de pagamento', value: data.methodLabel },
    { label: 'Valor da fatura hoje', value: formatBRL(data.amountToday) },
    ...(data.received > 0
      ? [{ label: 'Já recebido', value: formatBRL(data.received) }]
      : []),
    { label: 'Vencimento', value: formatDateBR(data.dueDate) },
    ...(data.description
      ? [{ label: 'Descrição', value: data.description }]
      : []),
  ];

  return renderEmail({
    brand: data.brand,
    subject: `Comprovante recebido: fatura de ${data.clientName}`,
    preheader: `${data.clientName} enviou um comprovante de pagamento por ${data.methodLabel}.`,
    blocks: [
      heading('Comprovante recebido'),
      paragraph(
        `${data.clientName} enviou um comprovante de pagamento por ${data.methodLabel}. Confira o valor no extrato e confirme o pagamento no Fature.`,
      ),
      details(rows),
      button('Conferir comprovante', data.invoiceUrl),
      note(
        'Confira no extrato antes de confirmar. Comprovante falso é um golpe comum.',
      ),
    ],
    footer: [
      'Você recebeu este aviso porque um cliente enviou um comprovante de pagamento pelo Fature.',
      'Para não receber mais, desligue o aviso em Configurações → Notificações.',
    ],
  });
}
