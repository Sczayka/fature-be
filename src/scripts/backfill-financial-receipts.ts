import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { ENTRY_ORIGIN } from '../financial/financial.constants.js';
import { InvoiceReceiptsService } from '../financial/receipts/invoice-receipts.service.js';
import { setupOrganizationFinancial } from '../financial/setup/organization-financial-setup.js';
import { todayInBillingTimezone } from '../invoices/pricing/dates.js';
import { ChargesService } from '../payments/charges.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Leva para o financeiro o que veio antes dele. Idempotente: pode rodar mais de uma vez. Rode logo
 * depois do `prisma db push` e do deploy do backend:
 *
 *   npm run build && npm run financial:backfill
 *
 * 1. Cada organização ganha as contas e as categorias padrão, com o saldo inicial em hoje.
 * 2. As movimentações confirmadas das faturas viram recebimentos (e as devoluções, saídas). Como
 *    são de antes do dia do saldo inicial, aparecem nos recebimentos sem mudar o saldo das contas:
 *    a empresa informa o saldo de hoje em cada conta.
 */

const logger = new Logger('BackfillFinancialReceipts');

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['log', 'warn', 'error'],
});

const prisma = app.get(PrismaService);
const charges = app.get(ChargesService);
const receipts = app.get(InvoiceReceiptsService);

async function setupOrganizations() {
  const today = todayInBillingTimezone();
  const organizations = await prisma.organization.findMany({
    select: { id: true },
  });

  for (const organization of organizations) {
    await prisma.$transaction((tx) =>
      setupOrganizationFinancial(tx, organization.id, today),
    );
  }

  logger.log(`Organizações configuradas: ${organizations.length}`);
}

/** Cada fatura sob o lock dela, como as movimentações novas. */
async function syncInvoiceReceipts() {
  const invoices = await prisma.invoice.findMany({
    where: { transactions: { some: {} } },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });

  for (const invoice of invoices) {
    await charges.withInvoiceLock(invoice.id, (tx) =>
      receipts.sync(tx, invoice.id),
    );
  }

  const entries = await prisma.financialEntry.count({
    where: { origin: ENTRY_ORIGIN.INVOICE },
  });

  logger.log(
    `Faturas sincronizadas: ${invoices.length}; lançamentos das faturas no financeiro: ${entries}`,
  );
}

try {
  await setupOrganizations();
  await syncInvoiceReceipts();

  logger.log('Backfill concluído');
} finally {
  await app.close();
}
