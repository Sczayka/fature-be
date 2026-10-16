import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Client, PaymentGatewayAccount } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CustomerProfile } from './providers/payment-provider.js';
import { PaymentProviderRegistry } from './providers/payment-provider.registry.js';

export function toCustomerProfile(client: Client): CustomerProfile {
  return {
    name: client.name,
    cpfCnpj: client.cpfCnpj,
    email: client.email,
    phone: client.phone,
    mobile: client.mobile,
    cep: client.cep,
    addressLine: client.addressLine,
    addressNumber: client.addressNumber,
    complement: client.complement,
    district: client.district,
    municipalInscription: client.municipalInscription,
    stateInscription: client.stateInscription,
  };
}

/** Cliente da organização dentro de cada conta de provedor (PaymentGatewayCustomer). */
@Injectable()
export class PaymentCustomersService {
  private readonly logger = new Logger(PaymentCustomersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PaymentProviderRegistry,
  ) {}

  /** ID do cliente no provedor da conta; criado lá na primeira cobrança roteada para ela. */
  async ensureCustomer(
    account: PaymentGatewayAccount,
    client: Client,
  ): Promise<string> {
    const link = await this.findLink(client.id, account.id);

    if (link) return link.externalId;

    const provider = this.registry.get(account.provider);
    const customer = await provider.createCustomer(
      account,
      toCustomerProfile(client),
    );

    try {
      await this.prisma.paymentGatewayCustomer.create({
        data: {
          clientId: client.id,
          paymentGatewayAccountId: account.id,
          externalId: customer.externalId,
          metadata: customer.metadata as Prisma.InputJsonObject,
        },
      });

      return customer.externalId;
    } catch (error) {
      // Outra cobrança criou o vínculo ao mesmo tempo: vale o dela, e o duplicado sai do provedor
      const concurrentLink = await this.findLink(client.id, account.id);

      if (!concurrentLink) throw error;

      await provider
        .deleteCustomer(account, customer.externalId)
        .catch((deleteError) =>
          this.logger.warn(
            `Cliente duplicado ${customer.externalId} não removido do provedor ${account.provider}`,
            deleteError,
          ),
        );

      return concurrentLink.externalId;
    }
  }

  /** Propaga as alterações do cliente aos provedores em que ele já existe (best effort). */
  async syncCustomer(client: Client): Promise<void> {
    const links = await this.prisma.paymentGatewayCustomer.findMany({
      where: { clientId: client.id },
      include: { paymentGatewayAccount: true },
    });

    await Promise.all(
      links.map(async (link) => {
        const account = link.paymentGatewayAccount;

        try {
          await this.registry
            .get(account.provider)
            .updateCustomer(
              account,
              link.externalId,
              toCustomerProfile(client),
            );
        } catch (error) {
          this.logger.error(
            `Cliente ${client.id} não atualizado no provedor ${account.provider}`,
            error,
          );
        }
      }),
    );
  }

  /** Remove o cliente dos provedores (best effort); os vínculos caem junto com o cliente. */
  async removeCustomer(clientId: string): Promise<void> {
    const links = await this.prisma.paymentGatewayCustomer.findMany({
      where: { clientId },
      include: { paymentGatewayAccount: true },
    });

    await Promise.all(
      links.map(async (link) => {
        const account = link.paymentGatewayAccount;

        try {
          await this.registry
            .get(account.provider)
            .deleteCustomer(account, link.externalId);
        } catch (error) {
          this.logger.error(
            `Cliente ${clientId} não removido do provedor ${account.provider}`,
            error,
          );
        }
      }),
    );
  }

  private findLink(clientId: string, paymentGatewayAccountId: string) {
    return this.prisma.paymentGatewayCustomer.findUnique({
      where: {
        clientId_paymentGatewayAccountId: { clientId, paymentGatewayAccountId },
      },
    });
  }
}
