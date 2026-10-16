import type { Prisma } from '@prisma/client';
import { GATEWAY_ACCOUNT_STATUS } from '../payments.constants.js';
import type { ProviderCapabilities } from '../providers/payment-provider.js';
import { selectCheapestProviders } from '../routing/select-cheapest-provider.js';

export type PaymentSetupClient = Pick<
  Prisma.TransactionClient,
  'platformPaymentMethod' | 'paymentGatewayAccount' | 'paymentGatewayMethod'
>;

export interface PaymentSetupOptions {
  capabilities: Record<string, ProviderCapabilities>;
  referenceAmount: number;
}

/**
 * Configuração de pagamentos de uma organização nova: uma conta em cada provedor vencedor e
 * as taxas padrão (PlatformPaymentMethod.defaultFee*) de cada método. As linhas nascem com
 * `isDefaultForMethod = false` e só o provedor de menor custo do método vira o padrão.
 *
 * Idempotente: uma organização que já tem métodos não muda (o padrão fica fixo; trocar o
 * provedor de uma organização existente é manual). Deve rodar dentro de uma transação.
 * Devolve se configurou algo.
 */
export async function setupOrganizationPayments(
  db: PaymentSetupClient,
  organizationId: string,
  options: PaymentSetupOptions,
): Promise<boolean> {
  const configuredMethods = await db.paymentGatewayMethod.count({
    where: { paymentGatewayAccount: { organizationId } },
  });

  if (configuredMethods > 0) return false;

  const rates = await db.platformPaymentMethod.findMany();
  const winners = selectCheapestProviders(
    rates,
    options.capabilities,
    options.referenceAmount,
  );
  const providers = [...new Set(Object.values(winners))];

  for (const provider of providers) {
    const account = await db.paymentGatewayAccount.upsert({
      where: { organizationId_provider: { organizationId, provider } },
      create: {
        organizationId,
        provider,
        accountId: '',
        status: GATEWAY_ACCOUNT_STATUS.AWAITING_COMPANY_INFO,
      },
      update: {},
    });

    await db.paymentGatewayMethod.createMany({
      data: rates
        .filter((rate) => rate.provider === provider)
        .map((rate) => ({
          paymentGatewayAccountId: account.id,
          method: rate.method,
          active: rate.active,
          isDefaultForMethod: false,
          feeFixed: rate.defaultFeeFixed,
          feePercent: rate.defaultFeePercent,
        })),
      skipDuplicates: true,
    });

    const wonMethods = Object.entries(winners)
      .filter(([, winner]) => winner === provider)
      .map(([method]) => method);

    await db.paymentGatewayMethod.updateMany({
      where: {
        paymentGatewayAccountId: account.id,
        method: { in: wonMethods },
      },
      data: { isDefaultForMethod: true },
    });
  }

  return providers.length > 0;
}
