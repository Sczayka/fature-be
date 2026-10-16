import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PaymentSetupService } from '../payments/payment-setup.service.js';
import { UpdateCompanyInfoDto } from './dto/update-company-info.dto.js';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentSetup: PaymentSetupService,
  ) {}

  async getCompanyInfo(id: string) {
    if (!id) {
      throw new BadRequestException('ID da organização não fornecido.');
    }

    const org = await this.prisma.organization.findUnique({
      where: { id },
    });

    return org;
  }

  async updateCompanyInfo(
    id: string,
    updateCompanyInfoDto: UpdateCompanyInfoDto,
  ) {
    if (!id) {
      throw new BadRequestException('ID da organização não fornecido.');
    }

    // Atualiza os dados da empresa e endereço no banco de dados
    const updatedOrg = await this.prisma.organization.update({
      where: { id },
      data: updateCompanyInfoDto,
    });

    // Abre as contas nos provedores que ainda aguardam os dados (ou que falharam); contas
    // ativas ou em abertura não mudam (idempotência)
    await this.paymentSetup.requestOnboarding(id);

    return updatedOrg;
  }

  getGatewayStatus(organizationId: string) {
    return this.paymentSetup.getStatus(organizationId);
  }
}
