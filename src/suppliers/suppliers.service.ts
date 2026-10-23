import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paginationMeta, utcDayRange } from '../common/utils/pagination.js';
import { isUniqueConstraintError } from '../common/utils/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateSupplierDto } from './dto/create-supplier.dto.js';
import { ListSuppliersQueryDto } from './dto/list-suppliers-query.dto.js';
import {
  SupplierBankAccountDto,
  hasBankTransferData,
} from './dto/supplier-bank-account.dto.js';
import { SupplierContactDto } from './dto/supplier-contact.dto.js';
import { UpdateSupplierDto } from './dto/update-supplier.dto.js';
import {
  SUPPLIER_DETAIL_SELECT,
  SUPPLIER_NOT_FOUND,
  SUPPLIER_SEARCH_LIMIT,
  SUPPLIER_SUMMARY_SELECT,
} from './suppliers.constants.js';

type SupplierDetailRow = Prisma.SupplierGetPayload<{
  select: typeof SUPPLIER_DETAIL_SELECT;
}>;

const SUPPLIER_SEARCH_SELECT = {
  id: true,
  name: true,
  tradeName: true,
  cpfCnpj: true,
  active: true,
  brands: { select: { brandId: true } },
} satisfies Prisma.SupplierSelect;

type SupplierSearchRow = Prisma.SupplierGetPayload<{
  select: typeof SUPPLIER_SEARCH_SELECT;
}>;

/**
 * Fornecedores da organização (de produtos e de serviços), com as marcas que fornecem, os contatos
 * e as contas para pagamento. Fornecedor em uso não é excluído, é inativado: some do seletor e da
 * busca, mas continua nos itens que já o usam. Os dados bancários só saem no detalhe.
 */
@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(organizationId: string, dto: CreateSupplierDto) {
    await this.assertUnique(organizationId, dto.name, dto.cpfCnpj);

    const brandIds = dto.brandIds ?? [];
    const contacts = splitById(
      dto.contacts ?? [],
      [],
      'Contato não encontrado',
    );
    const bankAccounts = splitById(
      dto.bankAccounts ?? [],
      [],
      'Conta bancária não encontrada',
    );

    try {
      const supplier = await this.prisma.$transaction(async (tx) => {
        assertSingleMain(
          contacts.created,
          'Marque no máximo um contato principal',
        );
        assertBankAccounts(bankAccounts.created);
        await this.assertBrandsAvailable(tx, organizationId, brandIds, []);

        return tx.supplier.create({
          data: {
            ...toSupplierData(dto),
            name: dto.name,
            organizationId,
            brands: { create: brandIds.map((brandId) => ({ brandId })) },
            contacts: { create: contacts.created.map(toContactData) },
            bankAccounts: {
              create: bankAccounts.created.map(toBankAccountData),
            },
          },
          select: SUPPLIER_DETAIL_SELECT,
        });
      });

      return toSupplierDetail(supplier);
    } catch (error) {
      throw toUniqueConflict(error);
    }
  }

  async findAll(organizationId: string, query: ListSuppliersQueryDto) {
    const { page, limit } = query;
    const where: Prisma.SupplierWhereInput = { organizationId };

    if (query.name) {
      where.OR = [
        { name: { contains: query.name, mode: 'insensitive' } },
        { tradeName: { contains: query.name, mode: 'insensitive' } },
      ];
    }

    if (query.cpfCnpj) where.cpfCnpj = { contains: query.cpfCnpj };
    if (query.active !== undefined) where.active = query.active;
    if (query.createdAt) where.createdAt = utcDayRange(query.createdAt);

    const [data, totalItems] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: SUPPLIER_SUMMARY_SELECT,
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return { data, meta: paginationMeta(page, limit, totalItems) };
  }

  /**
   * Seletores: só os ativos, por nome, nome fantasia ou documento; sem texto, os primeiros em ordem
   * alfabética. Com `brandId`, quem fornece a marca vem antes; `brandIds` permite destacá-los.
   */
  async search(organizationId: string, query: string, brandId?: string) {
    const where: Prisma.SupplierWhereInput = { organizationId, active: true };

    if (query) {
      const conditions: Prisma.SupplierWhereInput[] = [
        { name: { contains: query, mode: 'insensitive' } },
        { tradeName: { contains: query, mode: 'insensitive' } },
      ];

      // Documento digitado com ou sem a pontuação
      if (/^[\d\s./-]+$/.test(query)) {
        conditions.push({ cpfCnpj: { contains: query.replace(/\D/g, '') } });
      }

      where.OR = conditions;
    }

    const findPage = (filter: Prisma.SupplierWhereInput, take: number) =>
      this.prisma.supplier.findMany({
        where: { ...where, ...filter },
        select: SUPPLIER_SEARCH_SELECT,
        orderBy: { name: 'asc' },
        take,
      });

    if (!brandId) {
      return (await findPage({}, SUPPLIER_SEARCH_LIMIT)).map(toSearchResult);
    }

    const withBrand = await findPage(
      { brands: { some: { brandId } } },
      SUPPLIER_SEARCH_LIMIT,
    );
    const others =
      withBrand.length < SUPPLIER_SEARCH_LIMIT
        ? await findPage(
            { brands: { none: { brandId } } },
            SUPPLIER_SEARCH_LIMIT - withBrand.length,
          )
        : [];

    return [...withBrand, ...others].map(toSearchResult);
  }

  async findOne(id: string, organizationId: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, organizationId },
      select: SUPPLIER_DETAIL_SELECT,
    });

    if (!supplier) {
      throw new NotFoundException(SUPPLIER_NOT_FOUND);
    }

    return toSupplierDetail(supplier);
  }

  /**
   * Campo ausente não muda nada. `brandIds` substitui as marcas; `contacts` e `bankAccounts` são
   * sincronizados pelo id, tudo na mesma transação.
   */
  async update(id: string, organizationId: string, dto: UpdateSupplierDto) {
    await this.assertExists(id, organizationId);
    await this.assertUnique(organizationId, dto.name, dto.cpfCnpj, id);

    try {
      const supplier = await this.prisma.$transaction(async (tx) => {
        if (dto.brandIds !== undefined) {
          await this.replaceBrands(tx, organizationId, id, dto.brandIds);
        }

        if (dto.contacts !== undefined) {
          await this.syncContacts(tx, id, dto.contacts);
        }

        if (dto.bankAccounts !== undefined) {
          await this.syncBankAccounts(tx, id, dto.bankAccounts);
        }

        return tx.supplier.update({
          where: { id },
          data: toSupplierData(dto),
          select: SUPPLIER_DETAIL_SELECT,
        });
      });

      return toSupplierDetail(supplier);
    } catch (error) {
      throw toUniqueConflict(error);
    }
  }

  /**
   * Só sem itens vinculados e sem contas a pagar; as marcas, os contatos e as contas bancárias vão
   * junto.
   */
  async remove(id: string, organizationId: string) {
    await this.assertExists(id, organizationId);

    const [items, payables] = await Promise.all([
      this.prisma.itemSupplier.count({ where: { supplierId: id } }),
      this.prisma.financialEntry.count({ where: { supplierId: id } }),
    ]);

    if (items > 0) {
      throw new ConflictException(
        `Este fornecedor está em ${items === 1 ? '1 produto ou serviço' : `${items} produtos ou serviços`} e não pode ser excluído. Inative-o para que ele não apareça em novos cadastros.`,
      );
    }

    if (payables > 0) {
      throw new ConflictException(
        `Este fornecedor tem ${payables === 1 ? '1 conta a pagar' : `${payables} contas a pagar`} e não pode ser excluído. Inative-o para que ele não apareça em novos cadastros.`,
      );
    }

    return this.prisma.supplier.delete({
      where: { id },
      select: SUPPLIER_SUMMARY_SELECT,
    });
  }

  private async assertExists(id: string, organizationId: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });

    if (!supplier) {
      throw new NotFoundException(SUPPLIER_NOT_FOUND);
    }
  }

  /** Nome (sem diferenciar maiúsculas) e CPF/CNPJ únicos na organização; ausentes não são conferidos. */
  private async assertUnique(
    organizationId: string,
    name: string | undefined,
    cpfCnpj: string | null | undefined,
    exceptId?: string,
  ) {
    const conditions: Prisma.SupplierWhereInput[] = [];

    if (name !== undefined) {
      conditions.push({ name: { equals: name, mode: 'insensitive' } });
    }

    if (cpfCnpj) conditions.push({ cpfCnpj });

    if (conditions.length === 0) return;

    const existing = await this.prisma.supplier.findFirst({
      where: {
        organizationId,
        OR: conditions,
        ...(exceptId && { NOT: { id: exceptId } }),
      },
      select: { cpfCnpj: true, active: true },
    });

    if (!existing) return;

    const field =
      cpfCnpj && existing.cpfCnpj === cpfCnpj ? 'este CPF/CNPJ' : 'este nome';

    throw new ConflictException(
      existing.active
        ? `Já existe um fornecedor com ${field}.`
        : `Já existe um fornecedor inativo com ${field}: reative-o em vez de cadastrar outro.`,
    );
  }

  /** Marcas da organização; as que ainda não eram do fornecedor precisam estar ativas. */
  private async assertBrandsAvailable(
    tx: Prisma.TransactionClient,
    organizationId: string,
    brandIds: string[],
    currentBrandIds: string[],
  ) {
    if (brandIds.length === 0) return;

    const brands = await tx.brand.findMany({
      where: { id: { in: brandIds }, organizationId },
      select: { id: true, name: true, active: true },
    });

    if (brands.length !== brandIds.length) {
      throw new NotFoundException('Marca não encontrada');
    }

    const inactive = brands.find(
      (brand) => !brand.active && !currentBrandIds.includes(brand.id),
    );

    if (inactive) {
      throw new BadRequestException(
        `A marca ${inactive.name} está inativa: reative-a em Marcas para vinculá-la ao fornecedor`,
      );
    }
  }

  private async replaceBrands(
    tx: Prisma.TransactionClient,
    organizationId: string,
    supplierId: string,
    brandIds: string[],
  ) {
    const current = await tx.supplierBrand.findMany({
      where: { supplierId },
      select: { brandId: true },
    });

    await this.assertBrandsAvailable(
      tx,
      organizationId,
      brandIds,
      current.map((link) => link.brandId),
    );

    await tx.supplierBrand.deleteMany({
      where: { supplierId, brandId: { notIn: brandIds } },
    });
    await tx.supplierBrand.createMany({
      data: brandIds.map((brandId) => ({ supplierId, brandId })),
      skipDuplicates: true,
    });
  }

  private async syncContacts(
    tx: Prisma.TransactionClient,
    supplierId: string,
    contacts: SupplierContactDto[],
  ) {
    const existing = await tx.supplierContact.findMany({
      where: { supplierId },
      select: { id: true },
    });
    const { kept, created } = splitById(
      contacts,
      existing.map((contact) => contact.id),
      'Contato não encontrado',
    );

    assertSingleMain(contacts, 'Marque no máximo um contato principal');

    await tx.supplierContact.deleteMany({
      where: { supplierId, id: { notIn: kept.map((contact) => contact.id) } },
    });

    for (const contact of kept) {
      await tx.supplierContact.update({
        where: { id: contact.id },
        data: toContactData(contact),
      });
    }

    await tx.supplierContact.createMany({
      data: created.map((contact) => ({
        ...toContactData(contact),
        supplierId,
      })),
    });
  }

  private async syncBankAccounts(
    tx: Prisma.TransactionClient,
    supplierId: string,
    bankAccounts: SupplierBankAccountDto[],
  ) {
    const existing = await tx.supplierBankAccount.findMany({
      where: { supplierId },
      select: { id: true },
    });
    const { kept, created } = splitById(
      bankAccounts,
      existing.map((account) => account.id),
      'Conta bancária não encontrada',
    );

    assertBankAccounts(bankAccounts);

    await tx.supplierBankAccount.deleteMany({
      where: { supplierId, id: { notIn: kept.map((account) => account.id) } },
    });

    // Atualiza no lugar: o id da conta não muda, porque as contas a pagar apontam para ele
    for (const account of kept) {
      await tx.supplierBankAccount.update({
        where: { id: account.id },
        data: toBankAccountData(account),
      });
    }

    await tx.supplierBankAccount.createMany({
      data: created.map((account) => ({
        ...toBankAccountData(account),
        supplierId,
      })),
    });
  }
}

/**
 * Separa a lista enviada: com id, atualiza o registro, que precisa ser do fornecedor (e aparecer
 * uma vez só); sem id, cria.
 */
function splitById<T extends { id?: string }>(
  rows: T[],
  existingIds: string[],
  notFoundMessage: string,
) {
  const kept = rows.filter((row): row is T & { id: string } => !!row.id);
  const keptIds = kept.map((row) => row.id);

  if (
    new Set(keptIds).size !== keptIds.length ||
    keptIds.some((id) => !existingIds.includes(id))
  ) {
    throw new NotFoundException(notFoundMessage);
  }

  return { kept, created: rows.filter((row) => !row.id) };
}

function assertSingleMain(rows: { isMain?: boolean }[], message: string) {
  if (rows.filter((row) => row.isMain).length > 1) {
    throw new BadRequestException(message);
  }
}

/** No máximo uma principal, e cada conta com dados de transferência ou chave Pix. */
function assertBankAccounts(accounts: SupplierBankAccountDto[]) {
  assertSingleMain(accounts, 'Marque no máximo uma conta bancária principal');

  const index = accounts.findIndex(
    (account) => !hasBankTransferData(account) && !account.pixKey,
  );

  if (index >= 0) {
    throw new BadRequestException(
      `Conta bancária ${index + 1}: informe os dados bancários (banco, agência, conta e tipo) ou uma chave Pix`,
    );
  }
}

/** Colunas do próprio fornecedor; ausentes (undefined) não mudam. */
function toSupplierData(dto: UpdateSupplierDto) {
  return {
    name: dto.name,
    tradeName: dto.tradeName,
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
    paymentTermDays: dto.paymentTermDays,
    notes: dto.notes,
    active: dto.active,
  };
}

function toContactData(contact: SupplierContactDto) {
  return {
    name: contact.name,
    role: contact.role ?? null,
    email: contact.email ?? null,
    phone: contact.phone ?? null,
    mobile: contact.mobile ?? null,
    isMain: contact.isMain ?? false,
  };
}

function toBankAccountData(account: SupplierBankAccountDto) {
  return {
    bankCode: account.bankCode ?? null,
    bankName: account.bankName ?? null,
    branch: account.branch ?? null,
    accountNumber: account.accountNumber ?? null,
    accountType: account.accountType ?? null,
    holderName: account.holderName ?? null,
    holderDocument: account.holderDocument ?? null,
    pixKeyType: account.pixKeyType ?? null,
    pixKey: account.pixKey ?? null,
    isMain: account.isMain ?? false,
  };
}

function toSupplierDetail({ brands, ...supplier }: SupplierDetailRow) {
  return { ...supplier, brands: brands.map((link) => link.brand) };
}

function toSearchResult({ brands, ...supplier }: SupplierSearchRow) {
  return { ...supplier, brandIds: brands.map((link) => link.brandId) };
}

/** Outra requisição gravou o mesmo nome ou CPF/CNPJ entre a conferência e a escrita. */
function toUniqueConflict(error: unknown) {
  return isUniqueConstraintError(error)
    ? new ConflictException(
        'Já existe um fornecedor com este nome ou CPF/CNPJ.',
      )
    : error;
}
