import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  DraftClient,
  QUOTE_DOCUMENT_SELECT,
  toQuoteDocument,
} from '../../invoices/drafts/quote-document.js';
import {
  quotePdfFilename,
  renderQuotePdf,
} from '../../invoices/drafts/quote-pdf.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EMAIL_SOURCE, EMAIL_TYPE } from '../email.constants.js';
import {
  EmailLogView,
  EmailOutboxService,
} from '../outbox/email-outbox.service.js';
import { payerContext } from '../templates/payer.js';
import { renderQuoteEmail } from '../templates/quote.template.js';

/**
 * "Enviar via e-mail" no detalhe do orçamento. O orçamento vai no corpo e em PDF anexo: ele não
 * tem página pública.
 */
@Injectable()
export class QuoteEmailsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: EmailOutboxService,
  ) {}

  async send(
    organizationId: string,
    draftId: string,
    { to, requestedBy }: { to: string | null; requestedBy: string | null },
  ): Promise<EmailLogView> {
    const draft = await this.prisma.invoiceDraft.findFirst({
      where: { id: draftId, organizationId },
      select: QUOTE_DOCUMENT_SELECT,
    });

    if (!draft) throw new NotFoundException('Orçamento não encontrado');

    const quote = toQuoteDocument(draft);

    if (quote.lines.length === 0) {
      throw new UnprocessableEntityException(
        'Adicione itens ao orçamento antes de enviar.',
      );
    }

    const client = (draft.client ?? {}) as DraftClient;
    const recipient = to ?? quote.client.email;

    if (!recipient) {
      throw new UnprocessableEntityException(
        'O orçamento não tem o e-mail do cliente. Informe o destinatário.',
      );
    }

    if (await this.outbox.hasRecentManualSend({ invoiceDraftId: draftId })) {
      throw new HttpException(
        'Este orçamento acabou de ser enviado. Aguarde um minuto para enviar de novo.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const payer = payerContext(draft.organization);
    const log = await this.outbox.enqueue(
      {
        organizationId,
        clientId: await this.registeredClientId(organizationId, client.id),
        invoiceId: null,
        invoiceDraftId: draftId,
        type: EMAIL_TYPE.QUOTE,
        source: EMAIL_SOURCE.MANUAL,
        requestedBy,
        dedupeKey: null,
        recipient,
        sender: payer.sender,
        replyTo: payer.replyTo,
        content: renderQuoteEmail({
          payer,
          clientName: quote.client.name,
          description: quote.description,
          items: quote.lines.map((line) => ({
            name: line.name,
            quantity: line.quantity,
            total: line.total,
          })),
          subtotal: quote.subtotal,
          itemsDiscount: quote.itemsDiscount,
          total: quote.total,
          dueDate: quote.dueDate,
        }),
        attachments: [
          {
            filename: quotePdfFilename(quote),
            contentType: 'application/pdf',
            content: await renderQuotePdf(quote),
          },
        ],
      },
      { deliverNow: true },
    );

    // Sem dedupeKey, o registro sempre é criado
    if (!log) throw new Error(`E-mail do orçamento ${draftId} não registrado`);

    return log;
  }

  /**
   * Só liga o envio a um cliente cadastrado (e não excluído) nesta organização: o id vem do JSON do
   * orçamento.
   */
  private async registeredClientId(
    organizationId: string,
    clientId: string | undefined,
  ): Promise<string | null> {
    if (!clientId) return null;

    const client = await this.prisma.client.findFirst({
      where: { id: clientId, organizationId, deletedAt: null },
      select: { id: true },
    });

    return client?.id ?? null;
  }
}
