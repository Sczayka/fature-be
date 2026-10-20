import type { Prisma } from '@prisma/client';

/** Modelos de e-mail registrados em EmailLog: ao pagador e, no comprovante recebido, à empresa. */
export const EMAIL_TYPE = {
  INVOICE_ISSUED: 'INVOICE_ISSUED',
  INVOICE_REMINDER: 'INVOICE_REMINDER',
  INVOICE_OVERDUE: 'INVOICE_OVERDUE',
  INVOICE_PAID: 'INVOICE_PAID',
  QUOTE: 'QUOTE',
  /** À empresa: o pagador enviou um comprovante para conferir. */
  PAYMENT_PROOF_RECEIVED: 'PAYMENT_PROOF_RECEIVED',
  /** Ao pagador: o comprovante foi recusado, com o motivo. */
  PAYMENT_PROOF_REJECTED: 'PAYMENT_PROOF_REJECTED',
  /** Ao pagador: o valor confirmado não cobriu a fatura. */
  INVOICE_PARTIALLY_PAID: 'INVOICE_PARTIALLY_PAID',
} as const;

export type EmailType = (typeof EMAIL_TYPE)[keyof typeof EMAIL_TYPE];

export const EMAIL_STATUS = {
  /** Na fila, aguardando o worker. */
  QUEUED: 'QUEUED',
  /** Reservado por um envio em andamento até `nextAttemptAt`. */
  SENDING: 'SENDING',
  SENT: 'SENT',
  /** Falha temporária: nova tentativa em `nextAttemptAt`. */
  RETRYING: 'RETRYING',
  FAILED: 'FAILED',
  /** Não enviado (ex.: cliente sem e-mail ou fatura paga antes do envio). */
  SKIPPED: 'SKIPPED',
} as const;

export type EmailStatus = (typeof EMAIL_STATUS)[keyof typeof EMAIL_STATUS];

/** Status de quem ainda vai ser enviado: o SENDING com a reserva vencida volta para a fila. */
export const PENDING_EMAIL_STATUSES: EmailStatus[] = [
  EMAIL_STATUS.QUEUED,
  EMAIL_STATUS.RETRYING,
  EMAIL_STATUS.SENDING,
];

export const EMAIL_SOURCE = {
  AUTOMATIC: 'AUTOMATIC',
  MANUAL: 'MANUAL',
} as const;

export type EmailSource = (typeof EMAIL_SOURCE)[keyof typeof EMAIL_SOURCE];

/** Espera antes de cada nova tentativa (a 1ª entrada vale depois da 1ª falha). */
export const RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
];

/** Tentativas por e-mail: o último atraso acaba bem antes das 24 h da idempotência do Resend. */
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

/** Reserva de um envio: se o processo cair no meio, o e-mail volta para a fila depois disso. */
export const SENDING_LEASE_MS = 5 * 60_000;

/** Intervalo entre os envios da fila, abaixo do limite por segundo do Resend. */
export const SEND_SPACING_MS = 300;

export const PROCESS_BATCH_SIZE = 50;

/** Vencidas: só as que venceram nesses dias (evita uma rajada de e-mails no lançamento). */
export const OVERDUE_LOOKBACK_DAYS = 3;

/** Depois disso, o corpo dos e-mails finalizados é apagado; o registro fica. */
export const BODY_RETENTION_DAYS = 30;

/** Intervalo mínimo entre envios manuais da mesma fatura ou orçamento. */
export const MANUAL_COOLDOWN_MS = 60_000;

export const DEFAULT_EMAIL_FROM = 'nao-responda@fature.com.br';
export const DEFAULT_EMAIL_FROM_NAME = 'Fature';

/** Campos do registro devolvidos pela API (sem o corpo do e-mail). */
export const EMAIL_LOG_SELECT = {
  id: true,
  clientId: true,
  invoiceId: true,
  invoiceDraftId: true,
  type: true,
  source: true,
  recipient: true,
  subject: true,
  status: true,
  attempts: true,
  lastError: true,
  sentAt: true,
  createdAt: true,
} satisfies Prisma.EmailLogSelect;
