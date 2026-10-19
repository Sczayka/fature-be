import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { EmailSchedulerService } from '../email/scheduler/email-scheduler.service.js';
import { todayInBillingTimezone } from '../invoices/pricing/dates.js';

/**
 * Roda na hora a rotina diária dos e-mails (lembretes e vencidas) e envia a fila. Idempotente:
 * os avisos automáticos têm chave única.
 *
 *   npm run build && npm run emails:run-daily
 *   npm run emails:run-daily -- --date=2026-10-18
 */

const logger = new Logger('RunEmailJobs');

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['log', 'warn', 'error'],
});

const scheduler = app.get(EmailSchedulerService);
const dateArg = process.argv
  .find((arg) => arg.startsWith('--date='))
  ?.slice('--date='.length);

if (dateArg && !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
  logger.error(`Data inválida: ${dateArg} (use AAAA-MM-DD)`);
  await app.close();
  process.exit(1);
}

try {
  await scheduler.runDaily(dateArg ?? todayInBillingTimezone());

  // Envia o que entrou na fila (e o que já estava nela); os que falharem ficam para o worker
  let sent = 0;
  let batch: number;

  do {
    batch = await scheduler.drain();
    sent += batch;
  } while (batch > 0);

  logger.log(`Fila processada: ${sent} e-mails`);
} finally {
  await app.close();
}
