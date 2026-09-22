import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateClientDto } from './dto/create-client.dto.js';
import { UpdateClientDto } from './dto/update-client.dto.js';

import { AsaasService } from '../asaas/asaas.service.js';

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly asaasService: AsaasService,
  ) {}

  private async getAsaasApiKey(organizationId: string): Promise<string | null> {
    const asaasAccount = await this.prisma.paymentGatewayAccount.findFirst({
      where: {
        organizationId,
        provider: 'ASAAS',
        status: 'ACTIVE',
      },
    });

    if (!asaasAccount || !asaasAccount.metadata) return null;

    const metadata = asaasAccount.metadata as any;
    if (metadata.apiKey) {
      try {
        return this.asaasService.decryptApiKey(metadata.apiKey);
      } catch (err) {
        return metadata.apiKey; // Fallback in case it's not encrypted
      }
    }
    return null;
  }

  async create(organizationId: string, dto: CreateClientDto) {
    const OR_conditions: any[] = [{ name: dto.name }];
    
    if (dto.cpfCnpj) OR_conditions.push({ cpfCnpj: dto.cpfCnpj });
    if (dto.email) OR_conditions.push({ email: dto.email });
    if (dto.phone) OR_conditions.push({ phone: dto.phone });
    if (dto.mobile) OR_conditions.push({ mobile: dto.mobile });
    if (dto.municipalInscription) OR_conditions.push({ municipalInscription: dto.municipalInscription });
    if (dto.stateInscription) OR_conditions.push({ stateInscription: dto.stateInscription });

    const existingClient = await this.prisma.client.findFirst({
      where: {
        organizationId,
        OR: OR_conditions,
      },
    });

    if (existingClient) {
      throw new ConflictException('Já existe um cliente cadastrado com esses dados únicos (Nome, CPF/CNPJ, Email, Telefone, Inscrição Municipal ou Estadual).');
    }

    let asaasData = null;
    const subaccountApiKey = await this.getAsaasApiKey(organizationId);

    if (subaccountApiKey) {
      asaasData = await this.asaasService.createCustomer(subaccountApiKey, {
        name: dto.name,
        cpfCnpj: dto.cpfCnpj || '', // Asaas requires cpfCnpj, if we don't have it, Asaas API might complain, but we send it.
        email: dto.email,
        phone: dto.phone,
        mobilePhone: dto.mobile,
        address: dto.addressLine,
        addressNumber: dto.addressNumber,
        complement: dto.complement,
        province: dto.district,
        postalCode: dto.cep,
        municipalInscription: dto.municipalInscription,
        stateInscription: dto.stateInscription,
      });
    }

    const metadata = dto.metadata ?? {};
    if (asaasData) {
      metadata.asaas = asaasData;
    }

    return this.prisma.client.create({
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        mobile: dto.mobile,
        cpfCnpj: dto.cpfCnpj,
        cep: dto.cep,
        addressLine: dto.addressLine,
        addressNumber: dto.addressNumber,
        complement: dto.complement,
        district: dto.district,
        state: dto.state,
        city: dto.city,
        municipalInscription: dto.municipalInscription,
        stateInscription: dto.stateInscription,
        metadata: metadata,
        organizationId,
      },
    });
  }

  async findAll(
    organizationId: string, 
    page: number = 1, 
    limit: number = 10,
    filters?: { name?: string; email?: string; phone?: string; createdAt?: string }
  ) {
    const skip = (page - 1) * limit;

    const where: any = { organizationId };

    if (filters?.name) {
      where.name = { contains: filters.name, mode: 'insensitive' };
    }
    
    if (filters?.email) {
      where.email = { contains: filters.email, mode: 'insensitive' };
    }

    if (filters?.phone) {
      where.OR = [
        { phone: { contains: filters.phone, mode: 'insensitive' } },
        { mobile: { contains: filters.phone, mode: 'insensitive' } }
      ];
    }

    if (filters?.createdAt) {
      const date = new Date(filters.createdAt);
      if (!isNaN(date.getTime())) {
        const startOfDay = new Date(date);
        startOfDay.setUTCHours(0, 0, 0, 0);
        
        const endOfDay = new Date(date);
        endOfDay.setUTCHours(23, 59, 59, 999);

        where.createdAt = {
          gte: startOfDay,
          lte: endOfDay,
        };
      }
    }

    const [data, total_items] = await Promise.all([
      this.prisma.client.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.client.count({
        where,
      }),
    ]);

    const total_pages = Math.ceil(total_items / limit);

    return {
      data,
      meta: {
        page,
        per_page: limit,
        total_items,
        total_pages,
        has_next: page < total_pages,
        has_previous: page > 1,
      },
    };
  }

  async search(organizationId: string, query: string) {
    const cleanQuery = query.replace(/[.\-\/]/g, '');

    return this.prisma.client.findMany({
      where: {
        organizationId,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { cpfCnpj: { contains: cleanQuery, mode: 'insensitive' } },
        ],
      },
      orderBy: { name: 'asc' },
      take: 10,
    });
  }

  async findOne(id: string, organizationId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id, organizationId },
    });

    if (!client) {
      throw new NotFoundException('Cliente não encontrado');
    }

    return client;
  }

  async update(id: string, organizationId: string, dto: UpdateClientDto) {
    const client = await this.findOne(id, organizationId);

    const OR_conditions: any[] = [];
    if (dto.name) OR_conditions.push({ name: dto.name });
    if (dto.cpfCnpj) OR_conditions.push({ cpfCnpj: dto.cpfCnpj });
    if (dto.email) OR_conditions.push({ email: dto.email });
    if (dto.phone) OR_conditions.push({ phone: dto.phone });
    if (dto.mobile) OR_conditions.push({ mobile: dto.mobile });
    if (dto.municipalInscription) OR_conditions.push({ municipalInscription: dto.municipalInscription });
    if (dto.stateInscription) OR_conditions.push({ stateInscription: dto.stateInscription });

    if (OR_conditions.length > 0) {
      const existingClient = await this.prisma.client.findFirst({
        where: {
          organizationId,
          id: { not: id },
          OR: OR_conditions,
        },
      });

      if (existingClient) {
        throw new ConflictException('Já existe outro cliente cadastrado com esses dados únicos (Nome, CPF/CNPJ, Email, Telefone, Inscrição Municipal ou Estadual).');
      }
    }

    const metadata = (client.metadata as any) ?? {};
    
    // Atualizar no Asaas se o cliente estiver linkado
    if (metadata.asaas?.id) {
      const subaccountApiKey = await this.getAsaasApiKey(organizationId);
      if (subaccountApiKey) {
        try {
          const asaasData = await this.asaasService.updateCustomer(subaccountApiKey, metadata.asaas.id, {
            name: dto.name,
            cpfCnpj: dto.cpfCnpj,
            email: dto.email,
            phone: dto.phone,
            mobilePhone: dto.mobile,
            address: dto.addressLine,
            addressNumber: dto.addressNumber,
            complement: dto.complement,
            province: dto.district,
            postalCode: dto.cep,
            municipalInscription: dto.municipalInscription,
            stateInscription: dto.stateInscription,
          });
          metadata.asaas = asaasData;
        } catch (error) {
          // You might want to log this error and decide whether to block the DB update or not
          console.error(`Falha ao atualizar cliente no Asaas (ID: ${metadata.asaas.id})`, error);
        }
      }
    }
    
    const dtoMetadata = dto.metadata ?? {};
    const finalMetadata = { ...metadata, ...dtoMetadata };

    return this.prisma.client.update({
      where: { id },
      data: {
        ...dto,
        metadata: finalMetadata,
      },
    });
  }

  async remove(id: string, organizationId: string) {
    const client = await this.findOne(id, organizationId);
    
    const metadata = (client.metadata as any) ?? {};
    if (metadata.asaas?.id) {
      const subaccountApiKey = await this.getAsaasApiKey(organizationId);
      if (subaccountApiKey) {
        try {
          await this.asaasService.deleteCustomer(subaccountApiKey, metadata.asaas.id);
        } catch (error) {
          console.error(`Falha ao remover cliente no Asaas (ID: ${metadata.asaas.id})`, error);
          // If you want to prevent deletion in your DB if Asaas fails, throw here.
          // throw new Error('Não foi possível remover o cliente no provedor de pagamento.');
        }
      }
    }

    return this.prisma.client.delete({
      where: { id },
    });
  }
}
