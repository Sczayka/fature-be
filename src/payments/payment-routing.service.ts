import { Injectable } from '@nestjs/common';
import type {
  PaymentGatewayAccount,
  PaymentGatewayMethod,
  PlatformPaymentMethod,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  GATEWAY_ACCOUNT_STATUS,
  PAYMENT_METHODS,
  PaymentMethod,
} from './payments.constants.js';
import type { Rate } from './pricing/fees.js';
import type { PaymentProvider } from './providers/payment-provider.js';
import { PaymentProviderRegistry } from './providers/payment-provider.registry.js';

/** Para onde vai uma cobrança: conta e adaptador do provedor, com a taxa e o custo vigentes. */
export interface PaymentRoute {
  method: PaymentMethod;
  account: PaymentGatewayAccount;
  provider: PaymentProvider;
  /** Taxa negociada entre a organização e o Fature. */
  fee: Rate;
  /** Custo negociado entre o Fature e o provedor. */
  cost: Rate;
}

/** Método de pagamento como a organização o vê, sem o provedor. */
export interface OrganizationPaymentMethod {
  method: PaymentMethod;
  available: boolean;
  feeFixed: number;
  feePercent: number;
  receiptDays: number;
}

type DefaultMethodRow = PaymentGatewayMethod & {
  paymentGatewayAccount: PaymentGatewayAccount;
};

/**
 * Roteamento fixo: cada método vai para o provedor marcado como padrão da organização
 * (`isDefaultForMethod`), escolhido no registro pelo menor custo. Não há troca automática
 * de provedor em caso de falha.
 */
@Injectable()
export class PaymentRoutingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PaymentProviderRegistry,
  ) {}

  /** null = método indisponível para a organização. */
  async resolve(
    organizationId: string,
    method: PaymentMethod,
  ): Promise<PaymentRoute | null> {
    const { routes } = await this.load(organizationId);

    return routes.get(method) ?? null;
  }

  async getRoutes(
    organizationId: string,
  ): Promise<Map<PaymentMethod, PaymentRoute | null>> {
    return (await this.load(organizationId)).routes;
  }

  async listMethods(
    organizationId: string,
  ): Promise<OrganizationPaymentMethod[]> {
    const { defaults, routes } = await this.load(organizationId);

    return PAYMENT_METHODS.map((method) => {
      const row = defaults.find((item) => item.method === method);

      return {
        method,
        available: routes.get(method) != null,
        feeFixed: row?.feeFixed ?? 0,
        feePercent: row?.feePercent ?? 0,
        receiptDays: row?.receiptDays ?? 0,
      };
    });
  }

  private async load(organizationId: string) {
    const defaults = await this.prisma.paymentGatewayMethod.findMany({
      where: {
        isDefaultForMethod: true,
        paymentGatewayAccount: { organizationId },
      },
      include: { paymentGatewayAccount: true },
      orderBy: { createdAt: 'asc' },
    });

    const providers = [
      ...new Set(defaults.map((row) => row.paymentGatewayAccount.provider)),
    ];
    const platformRates = providers.length
      ? await this.prisma.platformPaymentMethod.findMany({
          where: { provider: { in: providers } },
        })
      : [];

    const routes = new Map<PaymentMethod, PaymentRoute | null>(
      PAYMENT_METHODS.map((method) => {
        const row = defaults.find((item) => item.method === method);

        return [method, row ? this.toRoute(method, row, platformRates) : null];
      }),
    );

    return { defaults, routes };
  }

  private toRoute(
    method: PaymentMethod,
    row: DefaultMethodRow,
    platformRates: PlatformPaymentMethod[],
  ): PaymentRoute | null {
    const account = row.paymentGatewayAccount;
    const provider = this.registry.find(account.provider);
    const platform = platformRates.find(
      (rate) => rate.provider === account.provider && rate.method === method,
    );

    if (
      !row.active ||
      account.status !== GATEWAY_ACCOUNT_STATUS.ACTIVE ||
      !provider ||
      !provider.capabilities.methods.includes(method) ||
      !platform?.active
    )
      return null;

    return {
      method,
      account,
      provider,
      fee: { fixed: row.feeFixed, percent: row.feePercent },
      cost: { fixed: platform.costFixed, percent: platform.costPercent },
    };
  }
}
