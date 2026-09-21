import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service.js';
import { AsaasService } from './asaas.service.js';

@Injectable()
export class AsaasListener {
  private readonly logger = new Logger(AsaasListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly asaasService: AsaasService,
  ) {}

  @OnEvent('company-info.updated')
  async handleCompanyInfoUpdated(payload: { organizationId: string }) {
    const { organizationId } = payload;
    this.logger.log(`Criando subconta Asaas para org: ${organizationId}`);

    try {
      // 1. Buscar dados da organização
      const org = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        include: {
          members: {
            where: { role: 'owner' },
            include: { user: true },
            take: 1,
          },
        },
      });

      if (!org || !org.cnpj) {
        throw new Error('Organização não encontrada ou CNPJ ausente');
      }

      // 2. Montar payload para o Asaas
      const owner = org.members[0]?.user;

      
      const asaasPayload = {
        name: org.name,
        // email: owner?.email ?? `org-${organizationId}@fature.com.br`,
        email: `org-${organizationId}@fature.com.br`,
        cpfCnpj: org.cnpj,
        companyType: org.companyType ?? undefined,
        phone: org.phone ?? undefined,
        mobilePhone: org.mobilePhone ?? undefined,
        incomeValue: org.incomeValue ?? undefined,
        address: org.address ?? undefined,
        addressNumber: org.addressNumber ?? undefined,
        complement: org.complement ?? undefined,
        province: org.province ?? undefined,
        postalCode: org.postalCode ?? undefined,
      };

      // 3. Criar subconta no Asaas
      const result = await this.asaasService.createSubaccount(asaasPayload);

      // 4. Criptografar apiKey e salvar
      const encryptedApiKey = this.asaasService.encryptApiKey(result.apiKey);

      const metadata = {
        ...result,
        apiKey: encryptedApiKey,         // Substituir plain text
        walletId: result.walletId,
      };

      await this.prisma.paymentGatewayAccount.update({
        where: {
          organizationId_provider: {
            organizationId,
            provider: 'ASAAS',
          },
        },
        data: {
          accountId: result.id,
          status: 'ACTIVE',
          metadata: metadata,
        },
      });

      this.logger.log(`Subconta Asaas criada com sucesso: ${result.id}`);
    } catch (error) {
      this.logger.error(`Falha ao criar subconta Asaas para org ${organizationId}:`, error);

      // Marcar como FAILED para que o usuário possa retentar
      await this.prisma.paymentGatewayAccount.update({
        where: {
          organizationId_provider: {
            organizationId,
            provider: 'ASAAS',
          },
        },
        data: { status: 'FAILED' },
      });
    }
  }
}
