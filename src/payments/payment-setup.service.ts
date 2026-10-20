import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import type { Organization } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { OrganizationPaymentMethodsService } from './organization-payment-methods.service.js';
import type { OrganizationPaymentMethod } from './payment-routing.service.js';
import {
  GATEWAY_ACCOUNT_STATUS,
  GatewayAccountStatus,
  PAYMENT_ACCOUNT_ONBOARDING_EVENT,
  getRoutingReferenceAmount,
} from './payments.constants.js';
import type { OrganizationProfile } from './providers/payment-provider.js';
import { PaymentProviderRegistry } from './providers/payment-provider.registry.js';
import { PROVIDER_CAPABILITIES } from './providers/provider-capabilities.js';
import { setupOrganizationPayments } from './setup/organization-payment-setup.js';

export interface PaymentsStatus {
  /** Alguma conta já foi aberta (ou está sendo aberta) em um provedor. */
  configured: boolean;
  /** Situação agregada das contas; null enquanto faltam os dados da empresa. */
  status: GatewayAccountStatus | null;
  canCreateInvoices: boolean;
  methods: OrganizationPaymentMethod[];
}

interface OnboardingEvent {
  accountId: string;
}

function toOrganizationProfile(
  organization: Organization & { cnpj: string },
): OrganizationProfile {
  return {
    id: organization.id,
    name: organization.name,
    cnpj: organization.cnpj,
    companyType: organization.companyType,
    phone: organization.phone,
    mobilePhone: organization.mobilePhone,
    incomeValue: organization.incomeValue,
    address: organization.address,
    addressNumber: organization.addressNumber,
    complement: organization.complement,
    province: organization.province,
    postalCode: organization.postalCode,
  };
}

/** Situação agregada: basta uma conta ativa para a organização operar. */
function aggregateStatus(statuses: string[]): GatewayAccountStatus | null {
  const order: GatewayAccountStatus[] = [
    GATEWAY_ACCOUNT_STATUS.ACTIVE,
    GATEWAY_ACCOUNT_STATUS.PENDING,
    GATEWAY_ACCOUNT_STATUS.FAILED,
  ];

  return order.find((status) => statuses.includes(status)) ?? null;
}

/** Configuração de pagamentos da organização e abertura das contas nos provedores. */
@Injectable()
export class PaymentSetupService {
  private readonly logger = new Logger(PaymentSetupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PaymentProviderRegistry,
    private readonly paymentMethods: OrganizationPaymentMethodsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /** Garante as contas e taxas padrão da organização (o hook do registro pode ter falhado). */
  async ensureConfigured(organizationId: string): Promise<void> {
    const configuredMethods = await this.prisma.paymentGatewayMethod.count({
      where: { paymentGatewayAccount: { organizationId } },
    });

    if (configuredMethods > 0) return;

    await this.prisma.$transaction((tx) =>
      setupOrganizationPayments(tx, organizationId, {
        capabilities: PROVIDER_CAPABILITIES,
        referenceAmount: getRoutingReferenceAmount(),
      }),
    );
  }

  /** Dados da empresa completos: abre a conta nos provedores ainda sem conta (ou que falharam). */
  async requestOnboarding(organizationId: string): Promise<void> {
    await this.ensureConfigured(organizationId);

    const accounts = await this.prisma.paymentGatewayAccount.findMany({
      where: {
        organizationId,
        status: {
          in: [
            GATEWAY_ACCOUNT_STATUS.AWAITING_COMPANY_INFO,
            GATEWAY_ACCOUNT_STATUS.FAILED,
          ],
        },
      },
    });

    for (const account of accounts) {
      await this.prisma.paymentGatewayAccount.update({
        where: { id: account.id },
        data: { status: GATEWAY_ACCOUNT_STATUS.PENDING },
      });

      this.eventEmitter.emit(PAYMENT_ACCOUNT_ONBOARDING_EVENT, {
        accountId: account.id,
      } satisfies OnboardingEvent);
    }
  }

  @OnEvent(PAYMENT_ACCOUNT_ONBOARDING_EVENT, { async: true })
  async handleOnboarding({ accountId }: OnboardingEvent): Promise<void> {
    const account = await this.prisma.paymentGatewayAccount.findUnique({
      where: { id: accountId },
      include: { organization: true },
    });

    if (!account || account.status !== GATEWAY_ACCOUNT_STATUS.PENDING) return;

    this.logger.log(
      `Abrindo conta ${account.provider} da organização ${account.organizationId}`,
    );

    try {
      const { organization } = account;

      if (!organization.cnpj) throw new Error('CNPJ da organização ausente');

      const provider = this.registry.get(account.provider);
      let current = { ...account };

      // A conta criada é gravada antes dos ajustes: uma nova tentativa não abre outra conta
      if (!current.accountId) {
        const created = await provider.createAccount(
          toOrganizationProfile({ ...organization, cnpj: organization.cnpj }),
        );

        current = await this.prisma.paymentGatewayAccount.update({
          where: { id: account.id },
          data: {
            accountId: created.accountId,
            metadata: created.metadata as Prisma.InputJsonObject,
          },
          include: { organization: true },
        });
      }

      const metadata = await provider.onboardAccount(current);

      await this.prisma.paymentGatewayAccount.update({
        where: { id: account.id },
        data: {
          metadata: metadata as Prisma.InputJsonObject,
          status: GATEWAY_ACCOUNT_STATUS.ACTIVE,
        },
      });

      this.logger.log(`Conta ${account.provider} ativa: ${current.accountId}`);
    } catch (error) {
      this.logger.error(
        `Falha ao abrir a conta ${account.provider} da organização ${account.organizationId}`,
        error,
      );

      // A organização tenta de novo ao salvar os dados da empresa
      await this.prisma.paymentGatewayAccount.update({
        where: { id: account.id },
        data: { status: GATEWAY_ACCOUNT_STATUS.FAILED },
      });
    }
  }

  async getStatus(organizationId: string): Promise<PaymentsStatus> {
    await this.ensureConfigured(organizationId);

    const [accounts, methods] = await Promise.all([
      this.prisma.paymentGatewayAccount.findMany({
        where: { organizationId },
        select: { status: true },
      }),
      // Com as formas manuais: só com elas a organização já emite faturas
      this.paymentMethods.list(organizationId),
    ]);

    const status = aggregateStatus(accounts.map((account) => account.status));

    return {
      configured: status !== null,
      status,
      canCreateInvoices: methods.some((method) => method.available),
      methods,
    };
  }
}
