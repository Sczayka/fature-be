import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  calcItemsDiscount,
  calcNominalValue,
  calcSubtotal,
  draftLines,
  pricingRulesFromDraft,
} from '../../invoices/pricing/invoice-pricing.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EMAIL_SOURCE, EMAIL_TYPE } from '../email.constants.js';
import {
  EmailLogView,
  EmailOutboxService,
} from '../outbox/email-outbox.service.js';
import { PAYER_ORGANIZATION_SELECT, payerContext } from '../templates/payer.js';
import { renderQuoteEmail } from '../templates/quote.template.js';

/** Bloco do cliente salvo no orçamento (pode não ser um cliente cadastrado). */
interface DraftClient {
  id?: string;
  name?: string;
  email?: string;
}

/** "Enviar via e-mail" no detalhe do orçamento. O orçamento vai no corpo: ele não tem página pública. */
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
      select: {
        client: true,
        items: true,
        billing: true,
        discount: true,
        interestAndFine: true,
        organization: { select: PAYER_ORGANIZATION_SELECT },
      },
    });

    if (!draft) throw new NotFoundException('Orçamento não encontrado');

    const lines = draftLines(draft.items);

    if (lines.length === 0) {
      throw new UnprocessableEntityException(
        'Adicione itens ao orçamento antes de enviar.',
      );
    }

    const client = (draft.client ?? {}) as DraftClient;
    const recipient = to ?? (client.email?.trim() || null);

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

    const rules = pricingRulesFromDraft(draft);
    const billing = draft.billing as {
      dueDate?: string;
      description?: string;
    } | null;
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
          clientName: client.name?.trim() || null,
          description: billing?.description?.trim() || null,
          items: lines.map((line) => ({
            name: line.item.name,
            quantity: line.quantity,
            total: line.total,
          })),
          subtotal: calcSubtotal(rules.items),
          itemsDiscount: calcItemsDiscount(rules),
          total: calcNominalValue(rules),
          dueDate: billing?.dueDate || null,
        }),
      },
      { deliverNow: true },
    );

    // Sem dedupeKey, o registro sempre é criado
    if (!log) throw new Error(`E-mail do orçamento ${draftId} não registrado`);

    return log;
  }

  /** Só liga o envio a um cliente cadastrado nesta organização (o id vem do JSON do orçamento). */
  private async registeredClientId(
    organizationId: string,
    clientId: string | undefined,
  ): Promise<string | null> {
    if (!clientId) return null;

    const client = await this.prisma.client.findFirst({
      where: { id: clientId, organizationId },
      select: { id: true },
    });

    return client?.id ?? null;
  }
}
