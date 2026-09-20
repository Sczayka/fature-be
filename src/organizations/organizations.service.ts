import { Injectable, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateCompanyInfoDto } from './dto/update-company-info.dto.js';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
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

  async updateCompanyInfo(id: string, updateCompanyInfoDto: UpdateCompanyInfoDto) {
    if (!id) {
      throw new BadRequestException('ID da organização não fornecido.');
    }

    // Atualiza os dados da empresa e endereço no banco de dados
    const updatedOrg = await this.prisma.organization.update({
      where: { id },
      data: updateCompanyInfoDto,
    });

    // Verificar se já existe gateway e emitir evento
    const existingGateway = await this.prisma.paymentGatewayAccount.findUnique({
      where: {
        organizationId_provider: {
          organizationId: id,
          provider: 'ASAAS',
        },
      },
    });

    if (!existingGateway) {
      // Primeira vez -> cria registro PENDING e dispara criação
      await this.prisma.paymentGatewayAccount.create({
        data: {
          organizationId: id,
          provider: 'ASAAS',
          accountId: '', // será preenchido pelo listener
          status: 'PENDING',
        },
      });

      this.eventEmitter.emit('company-info.updated', { organizationId: id });
    } else if (existingGateway.status === 'FAILED') {
      // Retry: usuario corrigiu dados -> tenta de novo
      await this.prisma.paymentGatewayAccount.update({
        where: { id: existingGateway.id },
        data: { status: 'PENDING' },
      });

      this.eventEmitter.emit('company-info.updated', { organizationId: id });
    }
    // Se ACTIVE ou PENDING -> não faz nada (idempotência)

    return updatedOrg;
  }

  async getGatewayStatus(organizationId: string) {
    const gateway = await this.prisma.paymentGatewayAccount.findUnique({
      where: {
        organizationId_provider: {
          organizationId,
          provider: 'ASAAS',
        },
      },
      select: {
        status: true,
        provider: true,
        createdAt: true,
      },
    });

    return {
      configured: !!gateway,
      status: gateway?.status ?? null,
      provider: gateway?.provider ?? null,
      canCreateCharges: gateway?.status === 'ACTIVE',
    };
  }
}
