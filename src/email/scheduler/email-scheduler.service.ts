import { Injectable, Logger } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  BILLING_TIMEZONE,
  INVOICE_STATUS,
} from '../../invoices/invoices.constants.js';
import {
  addDays,
  todayInBillingTimezone,
  utcMidnight,
} from '../../invoices/pricing/dates.js';
import {
  BODY_RETENTION_DAYS,
  EMAIL_STATUS,
  EMAIL_TYPE,
  OVERDUE_LOOKBACK_DAYS,
} from '../email.constants.js';
import {
  InvoiceEmailType,
  InvoiceEmailsService,
} from '../invoices/invoice-emails.service.js';
import { EmailOutboxService } from '../outbox/email-outbox.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DRAIN_INTERVAL_MS = 30_000;
const RECONCILE_INTERVAL_MS = 10 * 60_000;
/** Reconciliação: faturas desta janela sem o e-mail do evento (o processo pode ter caído). */
const RECONCILE_WINDOW_MS = 2 * 60 * 60_000;
/** Margem para o listener do evento terminar antes da reconciliação olhar a fatura. */
const RECONCILE_GRACE_MS = 2 * 60_000;
/** Lembrete só para faturas emitidas antes disso (o cliente acabou de receber a fatura). */
const REMINDER_MIN_AGE_MS = DAY_MS;

/** Sem lembrete nem aviso de vencida: paga, cancelada ou com comprovante a conferir. */
const CLOSED_STATUSES = [
  INVOICE_STATUS.PAID,
  INVOICE_STATUS.CANCELLED,
  INVOICE_STATUS.AWAITING_CONFIRMATION,
];

export interface DailyRunResult {
  reminders: number;
  overdue: number;
  purged: number;
}

/** EMAIL_WORKERS_ENABLED=false desliga as rotinas nesta instância (ex.: réplicas extras). */
function workersEnabled(): boolean {
  return process.env.EMAIL_WORKERS_ENABLED !== 'false';
}

/**
 * Rotinas dos e-mails aos pagadores: lembretes e vencidas do dia, a fila de envio e a
 * reconciliação dos e-mails de eventos. Os avisos automáticos têm chave única: rodar de novo não
 * repete e-mail.
 */
@Injectable()
export class EmailSchedulerService {
  private readonly logger = new Logger(EmailSchedulerService.name);
  private isDraining = false;
  private isReconciling = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: EmailOutboxService,
    private readonly invoiceEmails: InvoiceEmailsService,
  ) {}

  @Cron('0 8 * * *', {
    name: 'invoice-emails-daily',
    timeZone: BILLING_TIMEZONE,
  })
  async handleDaily(): Promise<void> {
    if (!workersEnabled()) return;

    try {
      await this.runDaily(todayInBillingTimezone());
    } catch (error) {
      this.logger.error('Rotina diária de e-mails falhou', error);
    }
  }

  @Interval(DRAIN_INTERVAL_MS)
  async handleDrain(): Promise<void> {
    if (!workersEnabled()) return;

    await this.drain();
  }

  @Interval(RECONCILE_INTERVAL_MS)
  async handleReconcile(): Promise<void> {
    if (!workersEnabled() || this.isReconciling) return;

    this.isReconciling = true;

    try {
      await this.reconcile(new Date());
    } catch (error) {
      this.logger.error('Reconciliação de e-mails falhou', error);
    } finally {
      this.isReconciling = false;
    }
  }

  /** Lembretes e vencidas de `today` (YYYY-MM-DD): só enfileira; a fila envia. */
  async runDaily(today: string): Promise<DailyRunResult> {
    const reminders = await this.queueReminders(today);
    const overdue = await this.queueOverdue(today);
    const purged = await this.outbox.purgeBodies(
      new Date(Date.now() - BODY_RETENTION_DAYS * DAY_MS),
    );

    this.logger.log(
      `E-mails de ${today}: ${reminders} lembretes e ${overdue} vencidas na fila; ${purged} corpos apagados`,
    );

    return { reminders, overdue, purged };
  }

  /** Envia o que estiver na fila; uma execução por vez neste processo. */
  async drain(): Promise<number> {
    if (this.isDraining) return 0;

    this.isDraining = true;

    try {
      return await this.outbox.processDue();
    } catch (error) {
      this.logger.error('Envio da fila de e-mails falhou', error);

      return 0;
    } finally {
      this.isDraining = false;
    }
  }

  /** E-mails de emissão e de pagamento que o evento não chegou a registrar. */
  async reconcile(now: Date): Promise<number> {
    const window = {
      gte: new Date(now.getTime() - RECONCILE_WINDOW_MS),
      lte: new Date(now.getTime() - RECONCILE_GRACE_MS),
    };
    const [issued, paid] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          createdAt: window,
          status: { not: INVOICE_STATUS.CANCELLED },
          organization: { notifyInvoiceIssued: true },
          emailLogs: { none: { type: EMAIL_TYPE.INVOICE_ISSUED } },
        },
        select: { id: true },
      }),
      this.prisma.invoice.findMany({
        where: {
          status: INVOICE_STATUS.PAID,
          updatedAt: window,
          organization: { notifyInvoicePaid: true },
          emailLogs: { none: { type: EMAIL_TYPE.INVOICE_PAID } },
        },
        select: { id: true },
      }),
    ]);
    const today = todayInBillingTimezone(now);
    let queued = 0;

    for (const { id } of issued) {
      queued += await this.queue(id, EMAIL_TYPE.INVOICE_ISSUED, today);
    }

    for (const { id } of paid) {
      queued += await this.queue(id, EMAIL_TYPE.INVOICE_PAID, today);
    }

    if (queued > 0) {
      this.logger.warn(
        `Reconciliação: ${queued} e-mails de eventos recuperados`,
      );
    }

    return queued;
  }

  /**
   * Faturas em aberto que vencem daqui a N dias, N da aba Notificações de cada empresa. A data de
   * vencimento decide, não o status gravado (um PIX vencido pode marcar a fatura como vencida antes).
   */
  private async queueReminders(today: string): Promise<number> {
    const groups = await this.prisma.organization.groupBy({
      by: ['invoiceReminderDays'],
      where: { notifyInvoiceReminder: true },
    });
    let queued = 0;

    for (const { invoiceReminderDays: days } of groups) {
      const dueDate = addDays(today, days);
      const invoices = await this.prisma.invoice.findMany({
        where: {
          dueDate: {
            gte: utcMidnight(dueDate),
            lt: utcMidnight(addDays(dueDate, 1)),
          },
          status: { notIn: CLOSED_STATUSES },
          createdAt: { lt: new Date(Date.now() - REMINDER_MIN_AGE_MS) },
          organization: {
            notifyInvoiceReminder: true,
            invoiceReminderDays: days,
          },
          emailLogs: { none: { type: EMAIL_TYPE.INVOICE_REMINDER } },
        },
        select: { id: true },
      });

      for (const { id } of invoices) {
        queued += await this.queue(id, EMAIL_TYPE.INVOICE_REMINDER, today);
      }
    }

    return queued;
  }

  /** Vencidas nos últimos dias: um aviso por fatura, a partir do dia seguinte ao vencimento. */
  private async queueOverdue(today: string): Promise<number> {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        dueDate: {
          gte: utcMidnight(addDays(today, -OVERDUE_LOOKBACK_DAYS)),
          lt: utcMidnight(today),
        },
        status: { notIn: CLOSED_STATUSES },
        organization: { notifyInvoiceOverdue: true },
        emailLogs: { none: { type: EMAIL_TYPE.INVOICE_OVERDUE } },
      },
      select: { id: true },
    });
    let queued = 0;

    for (const { id } of invoices) {
      queued += await this.queue(id, EMAIL_TYPE.INVOICE_OVERDUE, today);
    }

    return queued;
  }

  /** 1 quando o e-mail entrou na fila; uma fatura com problema não para as outras. */
  private async queue(
    invoiceId: string,
    type: InvoiceEmailType,
    today: string,
  ): Promise<number> {
    try {
      const log = await this.invoiceEmails.sendAutomatic(invoiceId, type, {
        deliverNow: false,
        today,
      });

      return log && log.status !== EMAIL_STATUS.SKIPPED ? 1 : 0;
    } catch (error) {
      this.logger.error(
        `E-mail ${type} da fatura ${invoiceId} não registrado`,
        error,
      );

      return 0;
    }
  }
}
