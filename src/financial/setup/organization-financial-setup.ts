import type { Prisma } from '@prisma/client';
import { utcMidnight } from '../../invoices/pricing/dates.js';
import {
  DEFAULT_CASH_ACCOUNT_NAME,
  DEFAULT_CATEGORIES,
  DEFAULT_MAIN_ACCOUNT_NAME,
  ENTRY_DIRECTIONS,
  FINANCIAL_ACCOUNT_TYPE,
  PROVIDER_ACCOUNT_NAME,
} from '../financial.constants.js';

export type FinancialSetupClient = Pick<
  Prisma.TransactionClient,
  | '$executeRaw'
  | 'financialAccount'
  | 'financialCategory'
  | 'paymentGatewayAccount'
>;

/** "ASAAS" vira "Asaas", para o nome da conta quando há mais de um provedor. */
function providerLabel(provider: string): string {
  return provider.charAt(0) + provider.slice(1).toLowerCase();
}

/**
 * Configuração padrão do financeiro de uma organização. Na primeira vez: a conta bancária
 * (principal), o dinheiro e as categorias padrão. Sempre: uma conta principal (ela recebe os
 * pagamentos manuais das faturas) e uma conta do caixa para cada conta da organização nos
 * provedores. As contas novas começam com saldo zero em `today` (YYYY-MM-DD).
 *
 * Idempotente. Deve rodar dentro de uma transação: trava a organização até o commit, para duas
 * chamadas ao mesmo tempo não criarem as contas em dobro.
 */
export async function setupOrganizationFinancial(
  db: FinancialSetupClient,
  organizationId: string,
  today: string,
): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`financial-setup:${organizationId}`}))`;

  const openingDate = utcMidnight(today);
  const accounts = await db.financialAccount.findMany({
    where: { organizationId },
    select: { isMain: true },
  });
  const mainAccount = {
    organizationId,
    name: DEFAULT_MAIN_ACCOUNT_NAME,
    type: FINANCIAL_ACCOUNT_TYPE.BANK,
    isMain: true,
    openingDate,
  };

  if (accounts.length === 0) {
    await db.financialAccount.createMany({
      data: [
        mainAccount,
        {
          organizationId,
          name: DEFAULT_CASH_ACCOUNT_NAME,
          type: FINANCIAL_ACCOUNT_TYPE.CASH,
          openingDate,
        },
      ],
    });
    await db.financialCategory.createMany({
      data: ENTRY_DIRECTIONS.flatMap((direction) =>
        DEFAULT_CATEGORIES[direction].map((name) => ({
          organizationId,
          name,
          direction,
        })),
      ),
      skipDuplicates: true,
    });
  } else if (!accounts.some((account) => account.isMain)) {
    await db.financialAccount.create({ data: mainAccount });
  }

  const gatewayAccounts = await db.paymentGatewayAccount.findMany({
    where: { organizationId },
    select: {
      id: true,
      provider: true,
      financialAccount: { select: { id: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  for (const gateway of gatewayAccounts) {
    if (gateway.financialAccount) continue;

    await db.financialAccount.create({
      data: {
        organizationId,
        name:
          gatewayAccounts.length > 1
            ? `${PROVIDER_ACCOUNT_NAME} (${providerLabel(gateway.provider)})`
            : PROVIDER_ACCOUNT_NAME,
        type: FINANCIAL_ACCOUNT_TYPE.PAYMENT_PROVIDER,
        paymentGatewayAccountId: gateway.id,
        openingDate,
      },
    });
  }
}
