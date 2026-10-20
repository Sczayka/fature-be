import { IsBoolean, IsInt, Max, Min } from 'class-validator';
import {
  REMINDER_DAYS_MAX,
  REMINDER_DAYS_MIN,
} from '../notifications.constants.js';

const REMINDER_DAYS_MESSAGE = `O lembrete deve sair de ${REMINDER_DAYS_MIN} a ${REMINDER_DAYS_MAX} dias antes do vencimento`;

/** Aba "Notificações": todos os e-mails automáticos de uma vez. */
export class UpdateNotificationSettingsDto {
  @IsBoolean({ message: 'Informe se o e-mail de fatura emitida é enviado' })
  notifyInvoiceIssued: boolean;

  @IsBoolean({ message: 'Informe se o lembrete de vencimento é enviado' })
  notifyInvoiceReminder: boolean;

  @IsInt({ message: REMINDER_DAYS_MESSAGE })
  @Min(REMINDER_DAYS_MIN, { message: REMINDER_DAYS_MESSAGE })
  @Max(REMINDER_DAYS_MAX, { message: REMINDER_DAYS_MESSAGE })
  invoiceReminderDays: number;

  @IsBoolean({ message: 'Informe se o aviso de fatura vencida é enviado' })
  notifyInvoiceOverdue: boolean;

  @IsBoolean({ message: 'Informe se a confirmação de pagamento é enviada' })
  notifyInvoicePaid: boolean;

  @IsBoolean({
    message: 'Informe se a empresa é avisada do comprovante recebido',
  })
  notifyPaymentProofReceived: boolean;

  @IsBoolean({
    message: 'Informe se o cliente é avisado do comprovante recusado',
  })
  notifyPaymentProofRejected: boolean;

  @IsBoolean({ message: 'Informe se o cliente é avisado do pagamento parcial' })
  notifyPartialPayment: boolean;
}
