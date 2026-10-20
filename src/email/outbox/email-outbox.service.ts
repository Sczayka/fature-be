import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, type EmailLog } from '@prisma/client';
import { setTimeout as sleep } from 'node:timers/promises';
import { INVOICE_STATUS } from '../../invoices/invoices.constants.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  EMAIL_LOG_SELECT,
  EMAIL_SOURCE,
  EMAIL_STATUS,
  EMAIL_TYPE,
  EmailStatus,
  MANUAL_COOLDOWN_MS,
  MAX_ATTEMPTS,
  PENDING_EMAIL_STATUSES,
  PROCESS_BATCH_SIZE,
  RETRY_DELAYS_MS,
  SEND_SPACING_MS,
  SENDING_LEASE_MS,
} from '../email.constants.js';
import type {
  EmailAttachment,
  EmailReference,
  EnqueueEmailInput,
  SkippedEmailInput,
} from '../email.types.js';
import {
  EMAIL_TRANSPORT,
  EmailDeliveryError,
  type EmailTransport,
} from '../transport/email-transport.js';

export type EmailLogView = Prisma.EmailLogGetPayload<{
  select: typeof EMAIL_LOG_SELECT;
}>;

/** Avisos de fatura em aberto: perdem o sentido se a fatura for paga ou cancelada antes do envio. */
const OPEN_INVOICE_TYPES: string[] = [
  EMAIL_TYPE.INVOICE_ISSUED,
  EMAIL_TYPE.INVOICE_REMINDER,
  EMAIL_TYPE.INVOICE_OVERDUE,
  EMAIL_TYPE.PAYMENT_PROOF_REJECTED,
  EMAIL_TYPE.INVOICE_PARTIALLY_PAID,
];

const FINISHED_STATUSES: EmailStatus[] = [
  EMAIL_STATUS.SENT,
  EMAIL_STATUS.FAILED,
  EMAIL_STATUS.SKIPPED,
];

/**
 * Fila de e-mails aos pagadores (outbox): cada e-mail é gravado já renderizado antes de sair, e as
 * novas tentativas reenviam o mesmo conteúdo com a mesma chave de idempotência. Um envio só sai
 * de quem reservou a linha, então o worker pode rodar em mais de uma instância.
 */
@Injectable()
export class EmailOutboxService {
  private readonly logger = new Logger(EmailOutboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_TRANSPORT) private readonly transport: EmailTransport,
  ) {}

  /**
   * Grava o e-mail. Com `deliverNow` a linha nasce reservada e sai na hora; sem, fica para o worker.
   * Devolve null quando o mesmo aviso automático já foi registrado (dedupeKey).
   */
  async enqueue(
    input: EnqueueEmailInput,
    { deliverNow }: { deliverNow: boolean },
  ): Promise<EmailLogView | null> {
    if (await this.isDuplicate(input.dedupeKey)) return null;

    const now = Date.now();
    const log = await this.create({
      ...referenceData(input),
      recipient: input.recipient,
      sender: input.sender,
      replyTo: input.replyTo,
      subject: input.content.subject,
      html: input.content.html,
      text: input.content.text,
      attachments: storedAttachments(input.attachments),
      status: deliverNow ? EMAIL_STATUS.SENDING : EMAIL_STATUS.QUEUED,
      attempts: deliverNow ? 1 : 0,
      nextAttemptAt: new Date(deliverNow ? now + SENDING_LEASE_MS : now),
    });

    if (!log) return null;

    return deliverNow ? this.deliver(log) : toView(log);
  }

  /** Registra um e-mail que não sai (ex.: cliente sem e-mail), para aparecer na tela do cliente. */
  async recordSkipped(input: SkippedEmailInput): Promise<EmailLogView | null> {
    if (await this.isDuplicate(input.dedupeKey)) return null;

    const log = await this.create({
      ...referenceData(input),
      recipient: null,
      sender: input.sender,
      subject: input.subject,
      status: EMAIL_STATUS.SKIPPED,
      lastError: input.reason,
    });

    return log && toView(log);
  }

  /** Envia os e-mails da fila cuja hora chegou. Devolve quantos foram processados. */
  async processDue(limit: number = PROCESS_BATCH_SIZE): Promise<number> {
    const now = new Date();
    const due = await this.prisma.emailLog.findMany({
      where: {
        status: { in: PENDING_EMAIL_STATUSES },
        nextAttemptAt: { lte: now },
      },
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    let processed = 0;

    for (const { id } of due) {
      const log = await this.claim(id, now);

      if (!log) continue;

      if (processed > 0) await sleep(SEND_SPACING_MS);

      await this.deliver(log);
      processed++;
    }

    return processed;
  }

  /** Houve envio manual desta fatura ou orçamento há pouco (evita cliques repetidos). */
  async hasRecentManualSend(
    where: { invoiceId: string } | { invoiceDraftId: string },
  ): Promise<boolean> {
    const recent = await this.prisma.emailLog.findFirst({
      where: {
        ...where,
        source: EMAIL_SOURCE.MANUAL,
        createdAt: { gt: new Date(Date.now() - MANUAL_COOLDOWN_MS) },
      },
      select: { id: true },
    });

    return recent !== null;
  }

  /** Apaga o corpo e os anexos dos e-mails finalizados antes de `before`; o registro do envio fica. */
  async purgeBodies(before: Date): Promise<number> {
    const { count } = await this.prisma.emailLog.updateMany({
      where: {
        status: { in: FINISHED_STATUSES },
        updatedAt: { lt: before },
        OR: [{ html: { not: null } }, { text: { not: null } }],
      },
      data: { html: null, text: null, attachments: Prisma.DbNull },
    });

    return count;
  }

  /** Reserva a linha para este envio; outra instância que chegar depois não a encontra. */
  private async claim(id: string, now: Date): Promise<EmailLog | null> {
    const { count } = await this.prisma.emailLog.updateMany({
      where: {
        id,
        status: { in: PENDING_EMAIL_STATUSES },
        nextAttemptAt: { lte: now },
      },
      data: {
        status: EMAIL_STATUS.SENDING,
        attempts: { increment: 1 },
        nextAttemptAt: new Date(Date.now() + SENDING_LEASE_MS),
      },
    });

    if (count === 0) return null;

    return this.prisma.emailLog.findUnique({ where: { id } });
  }

  /** Envia uma linha já reservada e grava o resultado. */
  private async deliver(log: EmailLog): Promise<EmailLogView> {
    const skipReason = await this.staleReason(log);

    if (skipReason) {
      return this.finish(log.id, {
        status: EMAIL_STATUS.SKIPPED,
        lastError: skipReason,
      });
    }

    if (!log.recipient || log.html === null || log.text === null) {
      return this.finish(log.id, {
        status: EMAIL_STATUS.FAILED,
        lastError: 'Conteúdo do e-mail indisponível.',
      });
    }

    try {
      const sent = await this.transport.send(
        {
          from: log.sender,
          to: log.recipient,
          replyTo: log.replyTo,
          subject: log.subject,
          html: log.html,
          text: log.text,
          attachments: parseAttachments(log.attachments),
          tags: { type: log.type },
        },
        { idempotencyKey: `email-log/${log.id}` },
      );

      return this.finish(log.id, {
        status: EMAIL_STATUS.SENT,
        sentAt: new Date(),
        providerMessageId: sent.providerMessageId,
        lastError: null,
      });
    } catch (error) {
      return this.fail(log, error);
    }
  }

  private fail(log: EmailLog, error: unknown): Promise<EmailLogView> {
    if (!(error instanceof EmailDeliveryError)) {
      this.logger.error(`Falha inesperada ao enviar o e-mail ${log.id}`, error);
    }

    const failure =
      error instanceof EmailDeliveryError
        ? error
        : new EmailDeliveryError('Falha inesperada no envio.', false);

    if (failure.permanent || log.attempts >= MAX_ATTEMPTS) {
      return this.finish(log.id, {
        status: EMAIL_STATUS.FAILED,
        lastError: failure.message,
      });
    }

    const delay = RETRY_DELAYS_MS[Math.max(log.attempts, 1) - 1];

    return this.finish(log.id, {
      status: EMAIL_STATUS.RETRYING,
      lastError: failure.message,
      nextAttemptAt: new Date(Date.now() + delay),
    });
  }

  /** Aviso automático de fatura em aberto que deixou de fazer sentido antes de sair. */
  private async staleReason(log: EmailLog): Promise<string | null> {
    if (
      log.source !== EMAIL_SOURCE.AUTOMATIC ||
      !OPEN_INVOICE_TYPES.includes(log.type)
    ) {
      return null;
    }

    const invoice = log.invoiceId
      ? await this.prisma.invoice.findUnique({
          where: { id: log.invoiceId },
          select: { status: true },
        })
      : null;

    if (!invoice) return 'Fatura excluída antes do envio.';
    if (invoice.status === INVOICE_STATUS.PAID) {
      return 'Fatura paga antes do envio.';
    }
    if (invoice.status === INVOICE_STATUS.CANCELLED) {
      return 'Fatura cancelada antes do envio.';
    }

    return null;
  }

  private finish(
    id: string,
    data: Prisma.EmailLogUpdateInput,
  ): Promise<EmailLogView> {
    return this.prisma.emailLog.update({
      where: { id },
      data,
      select: EMAIL_LOG_SELECT,
    });
  }

  /** Atalho; a garantia contra duplicados é o índice único (P2002 em `create`). */
  private async isDuplicate(dedupeKey: string | null): Promise<boolean> {
    if (!dedupeKey) return false;

    const existing = await this.prisma.emailLog.findUnique({
      where: { dedupeKey },
      select: { id: true },
    });

    return existing !== null;
  }

  private async create(
    data: Prisma.EmailLogUncheckedCreateInput,
  ): Promise<EmailLog | null> {
    try {
      return await this.prisma.emailLog.create({ data });
    } catch (error) {
      // Outro processo registrou o mesmo aviso automático entre a checagem e a gravação
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return null;
      }

      throw error;
    }
  }
}

function referenceData(reference: EmailReference) {
  return {
    organizationId: reference.organizationId,
    clientId: reference.clientId,
    invoiceId: reference.invoiceId,
    invoiceDraftId: reference.invoiceDraftId,
    type: reference.type,
    source: reference.source,
    requestedBy: reference.requestedBy,
    dedupeKey: reference.dedupeKey,
  };
}

/** Anexo como gravado no registro: o conteúdo vai em base64 no JSON (type, não interface: o Prisma exige um objeto JSON indexável). */
type StoredAttachment = {
  filename: string;
  contentType: string;
  content: string;
};

function storedAttachments(
  attachments: EmailAttachment[],
): Prisma.InputJsonValue | undefined {
  if (attachments.length === 0) return undefined;

  return attachments.map(
    ({ filename, contentType, content }): StoredAttachment => ({
      filename,
      contentType,
      content: content.toString('base64'),
    }),
  );
}

function parseAttachments(value: Prisma.JsonValue): EmailAttachment[] {
  if (!Array.isArray(value)) return [];

  return (value as unknown as StoredAttachment[]).map(
    ({ filename, contentType, content }) => ({
      filename,
      contentType,
      content: Buffer.from(content, 'base64'),
    }),
  );
}

function toView(log: EmailLog): EmailLogView {
  return {
    id: log.id,
    clientId: log.clientId,
    invoiceId: log.invoiceId,
    invoiceDraftId: log.invoiceDraftId,
    type: log.type,
    source: log.source,
    recipient: log.recipient,
    subject: log.subject,
    status: log.status,
    attempts: log.attempts,
    lastError: log.lastError,
    sentAt: log.sentAt,
    createdAt: log.createdAt,
  };
}
