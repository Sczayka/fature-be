import { Injectable } from '@nestjs/common';
import { todayInBillingTimezone } from '../../invoices/pricing/dates.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { setupOrganizationFinancial } from './organization-financial-setup.js';

/**
 * Garante as contas e as categorias padrão no acesso ao financeiro: o hook do cadastro da empresa
 * pode ter falhado, e as empresas anteriores ao financeiro não passaram por ele.
 */
@Injectable()
export class FinancialSetupService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureSetup(organizationId: string): Promise<void> {
    const [accounts, gatewaysWithoutAccount] = await Promise.all([
      this.prisma.financialAccount.findMany({
        where: { organizationId },
        select: { isMain: true },
      }),
      this.prisma.paymentGatewayAccount.count({
        where: { organizationId, financialAccount: { is: null } },
      }),
    ]);

    if (
      accounts.some((account) => account.isMain) &&
      gatewaysWithoutAccount === 0
    ) {
      return;
    }

    await this.prisma.$transaction((tx) =>
      setupOrganizationFinancial(tx, organizationId, todayInBillingTimezone()),
    );
  }
}
