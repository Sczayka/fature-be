import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { AppModule } from '../app.module.js';
import { PaymentCustomersService } from '../payments/payment-customers.service.js';
import { PaymentSetupService } from '../payments/payment-setup.service.js';
import {
  CHARGE_STATUS,
  GATEWAY_ACCOUNT_STATUS,
} from '../payments/payments.constants.js';
import { PaymentProviderRegistry } from '../payments/providers/payment-provider.registry.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Leva os dados de antes do núcleo de pagamentos para o modelo novo. Idempotente: pode rodar
 * mais de uma vez. Rode depois do `prisma db push` e do seed de PlatformPaymentMethod:
 *
 *   npm run build && npm run payments:backfill
 *
 * 1. Contas e taxas padrão das organizações existentes.
 * 2. Faturas: métodos habilitados, link de pagamento e boletos (InvoiceCharge).
 * 3. Clientes: `metadata.asaas` vira PaymentGatewayCustomer.
 * 4. Contas ativas: webhook e chave PIX no provedor; clientes com as notificações do provedor desligadas.
 *
 * Com `--db-only` (npm run payments:backfill -- --db-only), roda só os passos 1 a 3, sem
 * nenhuma chamada aos provedores.
 */

interface LegacyCharge {
  gatewayId?: string;
  invoiceUrl?: string | null;
  bankSlipUrl?: string | null;
  value?: number;
  dueDate?: string;
}

const logger = new Logger('BackfillPayments');

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['log', 'warn', 'error'],
});

const prisma = app.get(PrismaService);
const setup = app.get(PaymentSetupService);
const customers = app.get(PaymentCustomersService);
const registry = app.get(PaymentProviderRegistry);

async function configureOrganizations() {
  const organizations = await prisma.organization.findMany({
    select: { id: true },
  });

  for (const organization of organizations) {
    await setup.ensureConfigured(organization.id);
  }

  logger.log(`Organizações verificadas: ${organizations.length}`);
}

async function migrateInvoices() {
  const invoices = await prisma.invoice.findMany({
    where: {
      OR: [
        { checkoutToken: null },
        {
          paymentMethods: { isEmpty: true },
          legacyPaymentMethods: { not: Prisma.DbNull },
        },
      ],
    },
  });

  let charges = 0;

  for (const invoice of invoices) {
    const legacy = (invoice.legacyPaymentMethods ?? {}) as Record<
      string,
      LegacyCharge | null
    >;
    const meta = (invoice.meta ?? {}) as Record<string, { data?: unknown }>;

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        paymentMethods: invoice.paymentMethods.length
          ? invoice.paymentMethods
          : Object.keys(legacy),
        checkoutToken:
          invoice.checkoutToken ?? randomBytes(24).toString('base64url'),
      },
    });

    if (!invoice.paymentGatewayAccountId) continue;

    for (const [method, charge] of Object.entries(legacy)) {
      if (!charge?.gatewayId) continue;

      const exists = await prisma.invoiceCharge.findUnique({
        where: {
          paymentGatewayAccountId_externalId: {
            paymentGatewayAccountId: invoice.paymentGatewayAccountId,
            externalId: charge.gatewayId,
          },
        },
      });

      if (exists) continue;

      const isPaid = invoice.status === 'PAID';

      await prisma.invoiceCharge.create({
        data: {
          invoiceId: invoice.id,
          method,
          paymentGatewayAccountId: invoice.paymentGatewayAccountId,
          externalId: charge.gatewayId,
          status: isPaid ? CHARGE_STATUS.PAID : CHARGE_STATUS.PENDING,
          value: charge.value ?? invoice.totalValue,
          dueDate: charge.dueDate ? new Date(charge.dueDate) : invoice.dueDate,
          details: {
            invoiceUrl: charge.invoiceUrl ?? null,
            bankSlipUrl: charge.bankSlipUrl ?? null,
            identificationField: null,
            pixPayload: null,
            pixQrCodeImage: null,
            pixExpiresAt: null,
            receiptUrl: null,
          },
          providerResponse: (meta[method]?.data ??
            Prisma.DbNull) as Prisma.InputJsonValue,
          paidAt: isPaid ? invoice.paidAt : null,
          paidValue: isPaid ? invoice.paidValue : null,
        },
      });

      charges++;
    }
  }

  logger.log(
    `Faturas atualizadas: ${invoices.length}; cobranças migradas: ${charges}`,
  );
}

async function migrateClients() {
  const clients = await prisma.client.findMany({
    where: { metadata: { path: ['asaas', 'id'], not: Prisma.AnyNull } },
  });

  for (const client of clients) {
    const { asaas, ...metadata } = client.metadata as Record<string, any>;
    const account = await prisma.paymentGatewayAccount.findUnique({
      where: {
        organizationId_provider: {
          organizationId: client.organizationId,
          provider: 'ASAAS',
        },
      },
    });

    if (!account) {
      logger.warn(`Cliente ${client.id}: organização sem conta ASAAS`);
      continue;
    }

    await prisma.paymentGatewayCustomer.upsert({
      where: {
        clientId_paymentGatewayAccountId: {
          clientId: client.id,
          paymentGatewayAccountId: account.id,
        },
      },
      create: {
        clientId: client.id,
        paymentGatewayAccountId: account.id,
        externalId: asaas.id,
        metadata: asaas,
      },
      update: {},
    });

    await prisma.client.update({
      where: { id: client.id },
      data: { metadata },
    });
  }

  logger.log(`Clientes vinculados ao provedor: ${clients.length}`);
}

async function onboardActiveAccounts() {
  const accounts = await prisma.paymentGatewayAccount.findMany({
    where: { status: GATEWAY_ACCOUNT_STATUS.ACTIVE },
  });

  for (const account of accounts) {
    try {
      const metadata = await registry
        .get(account.provider)
        .onboardAccount(account);

      await prisma.paymentGatewayAccount.update({
        where: { id: account.id },
        data: { metadata: metadata as Prisma.InputJsonObject },
      });
    } catch (error) {
      logger.error(
        `Conta ${account.id} (${account.provider}) não ajustada`,
        error,
      );
    }
  }

  const linkedClients = await prisma.client.findMany({
    where: { gatewayCustomers: { some: {} } },
  });

  // Reenvia os clientes: os adaptadores desligam as notificações nativas do provedor
  for (const client of linkedClients) {
    await customers.syncCustomer(client);
  }

  logger.log(
    `Contas ativas ajustadas: ${accounts.length}; clientes sincronizados: ${linkedClients.length}`,
  );
}

const dbOnly = process.argv.includes('--db-only');

try {
  await configureOrganizations();
  await migrateInvoices();
  await migrateClients();

  if (dbOnly) logger.log('--db-only: ajustes nos provedores ignorados');
  else await onboardActiveAccounts();

  logger.log('Backfill concluído');
} finally {
  await app.close();
}
