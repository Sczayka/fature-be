import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { INVOICE_STATUS } from '../invoices/invoices.constants.js';
import { ChargesService } from '../payments/charges.service.js';
import {
  PIX_MODE,
  type PixMode,
} from '../payments/manual/manual-payments.constants.js';
import { CHARGE_STATUS } from '../payments/payments.constants.js';
import {
  TRANSACTION_SOURCE,
  TRANSACTION_STATUS,
  TRANSACTION_TYPE,
} from '../payments/transactions/transactions.constants.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Liga ou desliga o PIX manual de uma organização (só o admin do Fature roda, depois de combinar
 * com a empresa):
 *
 *   npm run build && npm run payments:pix-mode -- --org <organizationId> --mode MANUAL
 *   npm run build && npm run payments:pix-mode -- --org <organizationId> --mode AUTOMATIC [--force]
 *
 * - MANUAL: exige a chave PIX cadastrada (Configurações → Dados bancários) e cancela no provedor os
 *   PIX abertos das faturas em aberto, para ninguém pagar com taxa por um QR Code antigo.
 * - AUTOMATIC: recusa se alguma fatura em aberto já está sendo paga pelo PIX manual (comprovante
 *   pendente ou confirmado): ela ficaria travada numa forma indisponível, sem nada no checkout.
 *   Resolva antes (confirme, recuse ou lance o restante) ou use --force.
 */

const logger = new Logger('SetPixMode');

/** Faturas em que o checkout ainda recebe pagamento. */
const OPEN_INVOICE_STATUSES = [
  INVOICE_STATUS.PENDING,
  INVOICE_STATUS.OVERDUE,
  INVOICE_STATUS.AWAITING_CONFIRMATION,
];

const PIX_MODES = Object.values(PIX_MODE);

/** Valor do argumento: `--org abc` ou `--org=abc`. */
function argValue(name: string): string | null {
  const args = process.argv.slice(2);
  const inline = args.find((arg) => arg.startsWith(`--${name}=`));

  if (inline) return inline.slice(name.length + 3);

  const index = args.indexOf(`--${name}`);

  return index >= 0 ? (args[index + 1] ?? null) : null;
}

/** Erro esperado: só a mensagem vai para o log, e o processo termina com código 1. */
class ScriptError extends Error {}

const organizationId = argValue('org');
const mode = argValue('mode') as PixMode | null;
const force = process.argv.includes('--force');

if (!organizationId || !mode || !PIX_MODES.includes(mode)) {
  logger.error(
    'Uso: npm run payments:pix-mode -- --org <organizationId> --mode MANUAL|AUTOMATIC [--force]',
  );
  process.exit(1);
}

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['log', 'warn', 'error'],
});

const prisma = app.get(PrismaService);
const charges = app.get(ChargesService);

/** Cancela no provedor os PIX abertos das faturas em aberto; uma falha não para as outras. */
async function cancelOpenPix(organizationId: string) {
  const openPix = await prisma.invoiceCharge.findMany({
    where: {
      method: 'PIX',
      status: CHARGE_STATUS.PENDING,
      invoice: { organizationId, status: { in: OPEN_INVOICE_STATUSES } },
    },
    include: { paymentGatewayAccount: true },
  });
  let cancelled = 0;
  let failed = 0;

  for (const charge of openPix) {
    try {
      await charges.withInvoiceLock(charge.invoiceId, (tx) =>
        charges.cancelCharge(tx, charge),
      );
      cancelled += 1;
    } catch (error) {
      failed += 1;
      logger.error(
        `PIX ${charge.id} da fatura ${charge.invoiceId} não cancelado no provedor`,
        error,
      );
    }
  }

  logger.log(`PIX abertos cancelados: ${cancelled}; com falha: ${failed}`);
}

/** Faturas em aberto já sendo pagas pelo PIX manual (comprovante pendente ou confirmado). */
async function invoicesPaidWithManualPix(organizationId: string) {
  return prisma.invoice.findMany({
    where: {
      organizationId,
      status: { in: OPEN_INVOICE_STATUSES },
      transactions: {
        some: {
          type: TRANSACTION_TYPE.PAYMENT,
          method: 'PIX',
          source: {
            in: [TRANSACTION_SOURCE.CHECKOUT, TRANSACTION_SOURCE.OPERATOR],
          },
          status: {
            in: [
              TRANSACTION_STATUS.PENDING_REVIEW,
              TRANSACTION_STATUS.CONFIRMED,
            ],
          },
        },
      },
    },
    select: {
      id: true,
      status: true,
      dueDate: true,
      client: { select: { name: true } },
    },
    orderBy: { dueDate: 'asc' },
  });
}

try {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, pixMode: true, bankAccount: true },
  });

  if (!organization) {
    throw new ScriptError(`Organização ${organizationId} não encontrada`);
  }

  if (mode === PIX_MODE.MANUAL) {
    const account = organization.bankAccount;

    if (!account?.pixKeyType || !account.pixKey) {
      throw new ScriptError(
        'Cadastre a chave PIX em Configurações → Dados bancários antes de ligar o PIX manual.',
      );
    }
  } else if (!force) {
    const blocking = await invoicesPaidWithManualPix(organizationId);

    if (blocking.length > 0) {
      for (const invoice of blocking) {
        logger.warn(
          `Fatura ${invoice.id} (${invoice.client.name}, vence em ${invoice.dueDate.toISOString().slice(0, 10)}, ${invoice.status}) já está sendo paga pelo PIX manual`,
        );
      }

      throw new ScriptError(
        `${blocking.length} fatura(s) em aberto já estão sendo pagas pelo PIX manual. Confirme, recuse ou lance o restante antes de voltar para o PIX do provedor, ou rode de novo com --force.`,
      );
    }
  }

  await prisma.organization.update({
    where: { id: organizationId },
    data: { pixMode: mode },
  });

  logger.log(
    `PIX de ${organization.name} (${organizationId}): ${organization.pixMode} → ${mode}`,
  );

  // Ligado o manual, nenhum QR Code do provedor pode continuar valendo
  if (mode === PIX_MODE.MANUAL) await cancelOpenPix(organizationId);
} catch (error) {
  if (!(error instanceof ScriptError)) throw error;

  logger.error(error.message);
  process.exitCode = 1;
} finally {
  await app.close();
}
