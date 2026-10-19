import type { Prisma } from '@prisma/client';

/** Lembrete antes do vencimento: de 1 dia a 30 dias. */
export const REMINDER_DAYS_MIN = 1;
export const REMINDER_DAYS_MAX = 30;

/** E-mails automáticos aos pagadores que a organização liga ou desliga (aba Notificações). */
export const NOTIFICATION_SETTINGS_SELECT = {
  notifyInvoiceIssued: true,
  notifyInvoiceReminder: true,
  invoiceReminderDays: true,
  notifyInvoiceOverdue: true,
  notifyInvoicePaid: true,
} satisfies Prisma.OrganizationSelect;

export type NotificationSettings = Prisma.OrganizationGetPayload<{
  select: typeof NOTIFICATION_SETTINGS_SELECT;
}>;
