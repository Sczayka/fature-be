import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  MANUAL_PAYMENT_CONFIG_SELECT,
  ManualPaymentConfig,
  canReceiveBankTransfer,
  isManualPixMode,
  usesManualPix,
} from './manual/manual-payment-config.js';
import { PIX_MODE } from './manual/manual-payments.constants.js';
import {
  OrganizationPaymentMethod,
  PaymentRoutingService,
} from './payment-routing.service.js';
import type { PaymentMethod } from './payments.constants.js';

/** Organização sem as liberações do pagamento manual. */
const NO_MANUAL_PAYMENTS: ManualPaymentConfig = {
  bankTransferEnabled: false,
  pixMode: PIX_MODE.AUTOMATIC,
  bankAccount: null,
};

/** Forma paga por fora, com o comprovante: sem custo de processamento. */
function manualMethod(
  method: PaymentMethod,
  available: boolean,
): OrganizationPaymentMethod {
  return { method, available, feeFixed: 0, feePercent: 0, receiptDays: 0 };
}

/**
 * Formas de pagamento como a organização as vê: as do provedor (roteamento) e as manuais
 * (transferência e PIX com a chave da empresa), que dependem das liberações do admin do Fature e
 * dos dados bancários cadastrados.
 */
@Injectable()
export class OrganizationPaymentMethodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly routing: PaymentRoutingService,
  ) {}

  async list(organizationId: string): Promise<OrganizationPaymentMethod[]> {
    const [methods, config] = await Promise.all([
      this.routing.listMethods(organizationId),
      this.loadConfig(organizationId),
    ]);

    return methods.map((row) => {
      if (row.method === 'BANK_TRANSFER') {
        return manualMethod(row.method, canReceiveBankTransfer(config));
      }

      // No modo manual, o PIX nunca passa pelo provedor
      if (row.method === 'PIX' && isManualPixMode(config)) {
        return manualMethod(row.method, usesManualPix(config));
      }

      return row;
    });
  }

  async availability(
    organizationId: string,
  ): Promise<Map<PaymentMethod, boolean>> {
    const methods = await this.list(organizationId);

    return new Map(methods.map((row) => [row.method, row.available]));
  }

  private async loadConfig(
    organizationId: string,
  ): Promise<ManualPaymentConfig> {
    const config = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: MANUAL_PAYMENT_CONFIG_SELECT,
    });

    return config ?? NO_MANUAL_PAYMENTS;
  }
}
