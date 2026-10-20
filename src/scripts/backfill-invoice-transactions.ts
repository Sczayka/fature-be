import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { INVOICE_STATUS } from '../invoices/invoices.constants.js';
import { ChargesService } from '../payments/charges.service.js';
import { CHARGE_STATUS } from '../payments/payments.constants.js';
import { InvoiceTransactionsService } from '../payments/transactions/invoice-transactions.service.js';
import { TRANSACTION_TYPE } from '../payments/transactions/transactions.constants.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Leva os pagamentos de antes das movimentações para InvoiceTransaction. Idempotente: pode rodar
 * mais de uma vez. Rode logo depois do `prisma db push` e do deploy do backend:
 *
 *   npm run build && npm run transactions:backfill
 *
 * 1. Cada cobrança paga sem transação vira um pagamento do provedor, e a situação da fatura é
 *    recalculada na mesma transação: o excedente das duplicidades antigas aparece.
 * 2. Faturas pagas sem nenhuma cobrança paga (pagas antes das cobranças) só entram no log, para
 *    tratamento manual.
 */

const logger = new Logger('BackfillInvoiceTransactions');

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['log', 'warn', 'error'],
});

const prisma = app.get(PrismaService);
const charges = app.get(ChargesService);
const transactions = app.get(InvoiceTransactionsService);

/** Cada fatura numa transação: grava os pagamentos e recalcula, ou não muda nada. */
async function recordPaidCharges() {
  const paidCharges = await prisma.invoiceCharge.findMany({
    where: {
      status: CHARGE_STATUS.PAID,
      transactions: { none: { type: TRANSACTION_TYPE.PAYMENT } },
    },
    orderBy: { createdAt: 'asc' },
  });
  const chargesByInvoice = new Map<string, typeof paidCharges>();
  let withExcess = 0;

  for (const charge of paidCharges) {
    chargesByInvoice.set(charge.invoiceId, [
      ...(chargesByInvoice.get(charge.invoiceId) ?? []),
      charge,
    ]);
  }

  for (const [invoiceId, invoiceCharges] of chargesByInvoice) {
    const excessValue = await charges.withInvoiceLock(invoiceId, async (tx) => {
      for (const charge of invoiceCharges) {
        await transactions.recordGatewayPayment(tx, {
          invoiceId,
          chargeId: charge.id,
          method: charge.method,
          amount: charge.paidValue ?? charge.value,
          occurredAt: charge.paidAt ?? charge.updatedAt,
        });
      }

      // O e-mail de pagamento não sai: o markPaid já emitiu o evento na época do pagamento
      await transactions.applyBalance(tx, invoiceId);

      const invoice = await tx.invoice.findUniqueOrThrow({
        where: { id: invoiceId },
        select: { excessValue: true },
      });

      return invoice.excessValue;
    });

    if (excessValue > 0) withExcess += 1;
  }

  logger.log(
    `Cobranças pagas registradas como transação: ${paidCharges.length}; faturas recalculadas: ${chargesByInvoice.size}; com excedente a devolver: ${withExcess}`,
  );
}

async function reportPaidWithoutCharges() {
  const invoices = await prisma.invoice.findMany({
    where: {
      status: INVOICE_STATUS.PAID,
      charges: { none: { status: CHARGE_STATUS.PAID } },
    },
    select: { id: true, client: { select: { id: true, name: true } } },
  });

  for (const invoice of invoices) {
    logger.warn(
      `Fatura ${invoice.id} (cliente ${invoice.client.name}, ${invoice.client.id}) paga sem cobrança paga: sem transação, tratar manualmente`,
    );
  }

  logger.log(`Faturas pagas sem cobrança paga: ${invoices.length}`);
}

try {
  await recordPaidCharges();
  await reportPaidWithoutCharges();

  logger.log('Backfill concluído');
} finally {
  await app.close();
}
