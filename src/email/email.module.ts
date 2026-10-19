import { Module } from '@nestjs/common';
import { InvoiceEmailsController } from './invoices/invoice-emails.controller.js';
import { InvoiceEmailsListener } from './invoices/invoice-emails.listener.js';
import { InvoiceEmailsService } from './invoices/invoice-emails.service.js';
import { EmailLogsController } from './logs/email-logs.controller.js';
import { EmailLogsService } from './logs/email-logs.service.js';
import { EmailOutboxService } from './outbox/email-outbox.service.js';
import { QuoteEmailsController } from './quotes/quote-emails.controller.js';
import { QuoteEmailsService } from './quotes/quote-emails.service.js';
import { EmailSchedulerService } from './scheduler/email-scheduler.service.js';
import { EMAIL_TRANSPORT } from './transport/email-transport.js';
import { getEmailTransport } from './transport/get-email-transport.js';

/** E-mails aos pagadores: fila, modelos e envio. Prisma, eventos e agendamento são globais. */
@Module({
  controllers: [
    InvoiceEmailsController,
    QuoteEmailsController,
    EmailLogsController,
  ],
  providers: [
    // O mesmo transporte do Better Auth (src/auth/auth.config.ts)
    { provide: EMAIL_TRANSPORT, useFactory: getEmailTransport },
    EmailOutboxService,
    InvoiceEmailsService,
    InvoiceEmailsListener,
    QuoteEmailsService,
    EmailLogsService,
    EmailSchedulerService,
  ],
  exports: [EmailOutboxService, EmailSchedulerService],
})
export class EmailModule {}
