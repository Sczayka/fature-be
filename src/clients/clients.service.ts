import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { PaymentCustomersService } from '../payments/payment-customers.service.js';
import { paginationMeta, utcDayRange } from '../common/utils/pagination.js';
import { CLIENT_NOT_FOUND, CLIENT_SEARCH_LIMIT } from './clients.constants.js';
import { CreateClientDto } from './dto/create-client.dto.js';
import { ListClientsQueryDto } from './dto/list-clients-query.dto.js';
import { UpdateClientDto } from './dto/update-client.dto.js';

/** Cliente excluído (exclusão lógica) só aparece no histórico: faturas, orçamentos e e-mails. */
const NOT_DELETED = { deletedAt: null } satisfies Prisma.ClientWhereInput;

/**
 * Clientes da organização. O cliente só é criado em um provedor de pagamento na primeira
 * cobrança roteada para ele; aqui as alterações são propagadas.
 */
@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentCustomers: PaymentCustomersService,
  ) {}

  async create(organizationId: string, dto: CreateClientDto) {
    await this.assertUniqueData(organizationId, dto, null);

    return this.prisma.client.create({
      data: { ...this.toClientData(dto), name: dto.name, organizationId },
    });
  }

  async findAll(organizationId: string, query: ListClientsQueryDto) {
    const { page, limit } = query;
    const where: Prisma.ClientWhereInput = { organizationId, ...NOT_DELETED };

    if (query.name) where.name = { contains: query.name, mode: 'insensitive' };
    if (query.email)
      where.email = { contains: query.email, mode: 'insensitive' };
    if (query.phone)
      where.OR = [
        { phone: { contains: query.phone, mode: 'insensitive' } },
        { mobile: { contains: query.phone, mode: 'insensitive' } },
      ];
    if (query.createdAt) where.createdAt = utcDayRange(query.createdAt);

    const [data, totalItems] = await Promise.all([
      this.prisma.client.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.client.count({ where }),
    ]);

    return { data, meta: paginationMeta(page, limit, totalItems) };
  }

  async search(organizationId: string, query: string) {
    const cleanQuery = query.replace(/[.\-/]/g, '');

    return this.prisma.client.findMany({
      where: {
        organizationId,
        ...NOT_DELETED,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { cpfCnpj: { contains: cleanQuery, mode: 'insensitive' } },
        ],
      },
      orderBy: { name: 'asc' },
      take: CLIENT_SEARCH_LIMIT,
    });
  }

  async findOne(id: string, organizationId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id, organizationId, ...NOT_DELETED },
    });

    if (!client) {
      throw new NotFoundException(CLIENT_NOT_FOUND);
    }

    return client;
  }

  async update(id: string, organizationId: string, dto: UpdateClientDto) {
    await this.findOne(id, organizationId);
    await this.assertUniqueData(organizationId, dto, id);

    const updatedClient = await this.prisma.client.update({
      where: { id },
      data: this.toClientData(dto),
    });

    // Leva as alterações aos provedores em que o cliente já existe (falhas não bloqueiam)
    await this.paymentCustomers.syncCustomer(updatedClient);

    return updatedClient;
  }

  /**
   * Exclusão lógica: o cliente some da lista e da busca, e as faturas, os orçamentos e os e-mails
   * dele continuam no histórico. Ele também fica no provedor de pagamento: excluí-lo lá removeria
   * as cobranças pendentes, que continuam valendo.
   */
  async remove(id: string, organizationId: string) {
    await this.findOne(id, organizationId);

    return this.prisma.client.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Nome, documento, e-mail, telefones e inscrições não se repetem entre os clientes da organização.
   * O excluído não conta: o mesmo cliente pode ser cadastrado de novo.
   */
  private async assertUniqueData(
    organizationId: string,
    dto: UpdateClientDto,
    ignoredId: string | null,
  ) {
    const conditions: Prisma.ClientWhereInput[] = [];

    if (dto.name) conditions.push({ name: dto.name });
    if (dto.cpfCnpj) conditions.push({ cpfCnpj: dto.cpfCnpj });
    if (dto.email)
      conditions.push({ email: { equals: dto.email, mode: 'insensitive' } });
    if (dto.phone) conditions.push({ phone: dto.phone });
    if (dto.mobile) conditions.push({ mobile: dto.mobile });
    if (dto.municipalInscription)
      conditions.push({ municipalInscription: dto.municipalInscription });
    if (dto.stateInscription)
      conditions.push({ stateInscription: dto.stateInscription });

    if (conditions.length === 0) return;

    const existingClient = await this.prisma.client.findFirst({
      where: {
        organizationId,
        ...NOT_DELETED,
        ...(ignoredId ? { id: { not: ignoredId } } : {}),
        OR: conditions,
      },
      select: { id: true },
    });

    if (existingClient) {
      throw new ConflictException(
        ignoredId
          ? 'Já existe outro cliente cadastrado com esses dados únicos (Nome, CPF/CNPJ, Email, Telefone, Inscrição Municipal ou Estadual).'
          : 'Já existe um cliente cadastrado com esses dados únicos (Nome, CPF/CNPJ, Email, Telefone, Inscrição Municipal ou Estadual).',
      );
    }
  }

  /** Só os campos do cadastro: o corpo nunca grava a organização, o id ou os metadados do provedor. */
  private toClientData(dto: UpdateClientDto) {
    return {
      name: dto.name,
      email: dto.email,
      phone: dto.phone,
      mobile: dto.mobile,
      cpfCnpj: dto.cpfCnpj,
      municipalInscription: dto.municipalInscription,
      stateInscription: dto.stateInscription,
      cep: dto.cep,
      addressLine: dto.addressLine,
      addressNumber: dto.addressNumber,
      complement: dto.complement,
      district: dto.district,
      state: dto.state,
      city: dto.city,
    } satisfies Prisma.ClientUpdateInput;
  }
}
