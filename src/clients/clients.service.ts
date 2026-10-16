import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PaymentCustomersService } from '../payments/payment-customers.service.js';
import { CreateClientDto } from './dto/create-client.dto.js';
import { UpdateClientDto } from './dto/update-client.dto.js';

/**
 * Clientes da organização. O cliente só é criado em um provedor de pagamento na primeira
 * cobrança roteada para ele; aqui as alterações e a exclusão são propagadas.
 */
@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentCustomers: PaymentCustomersService,
  ) {}

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

    const metadata = dto.metadata ?? {};

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
    const finalMetadata = { ...metadata, ...dto.metadata };

    const updatedClient = await this.prisma.client.update({
      where: { id },
      data: {
        ...dto,
        metadata: finalMetadata,
      },
    });

    // Leva as alterações aos provedores em que o cliente já existe (falhas não bloqueiam)
    await this.paymentCustomers.syncCustomer(updatedClient);

    return updatedClient;
  }

  async remove(id: string, organizationId: string) {
    await this.findOne(id, organizationId);

    // Remove o cliente dos provedores (falhas não bloqueiam a exclusão no Fature)
    await this.paymentCustomers.removeCustomer(id);

    return this.prisma.client.delete({
      where: { id },
    });
  }
}
