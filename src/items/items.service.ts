import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { roundCurrency } from '../common/utils/currency.js';
import { paginationMeta, utcDayRange } from '../common/utils/pagination.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateItemDto } from './dto/create-item.dto.js';
import { ItemSupplierDto } from './dto/item-supplier.dto.js';
import { ListItemsQueryDto } from './dto/list-items-query.dto.js';
import { UpdateItemDto } from './dto/update-item.dto.js';
import {
  ITEM_BRAND_SELECT,
  ITEM_DETAIL_INCLUDE,
  ITEM_NOT_FOUND,
  ITEM_SEARCH_LIMIT,
  ITEM_SUPPLIER_SELECT,
  SERVICE_BRAND_MESSAGE,
} from './items.constants.js';

type ItemSupplierRow = Prisma.ItemSupplierGetPayload<{
  select: typeof ITEM_SUPPLIER_SELECT;
}>;

/**
 * Produtos e serviços da organização, com a marca (só produto) e os fornecedores. Marca e
 * fornecedores precisam ser da organização; inativos continuam nos itens que já os usam, mas não
 * entram em vínculos novos.
 */
@Injectable()
export class ItemsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(organizationId: string, dto: CreateItemDto) {
    const brandId = dto.brandId ?? null;
    const suppliers = dto.suppliers ?? [];

    if (dto.type === 'service' && brandId) {
      throw new BadRequestException(SERVICE_BRAND_MESSAGE);
    }

    const item = await this.prisma.$transaction(async (tx) => {
      if (brandId) await this.assertBrandAvailable(tx, organizationId, brandId);
      await this.assertSuppliersAvailable(tx, organizationId, suppliers, []);

      return tx.item.create({
        data: {
          name: dto.name,
          type: dto.type,
          price: roundCurrency(dto.price),
          stock: dto.stock,
          description: dto.description,
          brandId,
          organizationId,
          suppliers: { create: suppliers.map(toItemSupplierData) },
        },
        include: ITEM_DETAIL_INCLUDE,
      });
    });

    return toItemDetail(item);
  }

  async findAll(organizationId: string, query: ListItemsQueryDto) {
    const { page, limit, supplierId } = query;
    const where: Prisma.ItemWhereInput = { organizationId };

    if (query.name) where.name = { contains: query.name, mode: 'insensitive' };
    if (query.type) where.type = query.type;
    if (query.price !== undefined) where.price = query.price;
    if (query.createdAt) where.createdAt = utcDayRange(query.createdAt);
    if (query.brandId) where.brandId = query.brandId;
    if (supplierId) where.suppliers = { some: { supplierId } };

    const pageArgs = {
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    } satisfies Prisma.ItemFindManyArgs;

    const [data, totalItems] = await Promise.all([
      supplierId
        ? // Aba "Produtos e serviços" do fornecedor: só o vínculo com ele (código e preço de compra)
          this.prisma.item
            .findMany({
              ...pageArgs,
              include: {
                brand: { select: ITEM_BRAND_SELECT },
                suppliers: {
                  where: { supplierId },
                  select: ITEM_SUPPLIER_SELECT,
                },
              },
            })
            .then((items) => items.map(toItemDetail))
        : this.prisma.item.findMany({
            ...pageArgs,
            include: { brand: { select: ITEM_BRAND_SELECT } },
          }),
      this.prisma.item.count({ where }),
    ]);

    return { data, meta: paginationMeta(page, limit, totalItems) };
  }

  async search(organizationId: string, query: string) {
    return this.prisma.item.findMany({
      where: {
        organizationId,
        name: { contains: query, mode: 'insensitive' },
      },
      orderBy: { name: 'asc' },
      take: ITEM_SEARCH_LIMIT,
    });
  }

  async findOne(id: string, organizationId: string) {
    const item = await this.prisma.item.findFirst({
      where: { id, organizationId },
      include: ITEM_DETAIL_INCLUDE,
    });

    if (!item) {
      throw new NotFoundException(ITEM_NOT_FOUND);
    }

    return toItemDetail(item);
  }

  /** Campo ausente não muda nada; `suppliers` substitui a lista inteira. */
  async update(id: string, organizationId: string, dto: UpdateItemDto) {
    const item = await this.prisma.$transaction(async (tx) => {
      const current = await tx.item.findFirst({
        where: { id, organizationId },
        select: {
          type: true,
          brandId: true,
          suppliers: { select: { supplierId: true } },
        },
      });

      if (!current) {
        throw new NotFoundException(ITEM_NOT_FOUND);
      }

      const brandId = nextBrandId(
        dto.type ?? current.type,
        current.brandId,
        dto.brandId,
      );

      if (brandId && brandId !== current.brandId) {
        await this.assertBrandAvailable(tx, organizationId, brandId);
      }

      if (dto.suppliers !== undefined) {
        await this.assertSuppliersAvailable(
          tx,
          organizationId,
          dto.suppliers,
          current.suppliers.map((link) => link.supplierId),
        );
        await tx.itemSupplier.deleteMany({ where: { itemId: id } });
      }

      return tx.item.update({
        where: { id },
        data: {
          name: dto.name,
          type: dto.type,
          price: dto.price === undefined ? undefined : roundCurrency(dto.price),
          stock: dto.stock,
          description: dto.description,
          brandId,
          suppliers: dto.suppliers && {
            create: dto.suppliers.map(toItemSupplierData),
          },
        },
        include: ITEM_DETAIL_INCLUDE,
      });
    });

    return toItemDetail(item);
  }

  /** Os vínculos com fornecedores vão junto; as faturas guardam uma cópia do item. */
  async remove(id: string, organizationId: string) {
    const item = await this.prisma.item.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });

    if (!item) {
      throw new NotFoundException(ITEM_NOT_FOUND);
    }

    return this.prisma.item.delete({
      where: { id },
    });
  }

  /** Marca nova no item: da organização e ativa. */
  private async assertBrandAvailable(
    tx: Prisma.TransactionClient,
    organizationId: string,
    brandId: string,
  ) {
    const brand = await tx.brand.findFirst({
      where: { id: brandId, organizationId },
      select: { name: true, active: true },
    });

    if (!brand) {
      throw new NotFoundException('Marca não encontrada');
    }

    if (!brand.active) {
      throw new BadRequestException(
        `A marca ${brand.name} está inativa: reative-a em Marcas para usá-la em novos produtos`,
      );
    }
  }

  /**
   * Fornecedores do item: sem repetição, no máximo um principal, todos da organização e, os que
   * ainda não estavam no item, ativos.
   */
  private async assertSuppliersAvailable(
    tx: Prisma.TransactionClient,
    organizationId: string,
    links: ItemSupplierDto[],
    currentSupplierIds: string[],
  ) {
    const supplierIds = links.map((link) => link.supplierId);

    if (new Set(supplierIds).size !== supplierIds.length) {
      throw new BadRequestException(
        'O mesmo fornecedor aparece mais de uma vez no item',
      );
    }

    if (links.filter((link) => link.isMain).length > 1) {
      throw new BadRequestException('Marque no máximo um fornecedor principal');
    }

    if (supplierIds.length === 0) return;

    const suppliers = await tx.supplier.findMany({
      where: { id: { in: supplierIds }, organizationId },
      select: { id: true, name: true, active: true },
    });

    if (suppliers.length !== supplierIds.length) {
      throw new NotFoundException('Fornecedor não encontrado');
    }

    const inactive = suppliers.find(
      (supplier) =>
        !supplier.active && !currentSupplierIds.includes(supplier.id),
    );

    if (inactive) {
      throw new BadRequestException(
        `O fornecedor ${inactive.name} está inativo: reative-o em Fornecedores para vinculá-lo a novos itens`,
      );
    }
  }
}

/**
 * Marca a gravar: undefined mantém a atual. Serviço não tem marca, então virar serviço tira a
 * marca do produto e um brandId enviado para serviço é recusado.
 */
function nextBrandId(
  type: string,
  currentBrandId: string | null,
  requested: string | null | undefined,
): string | null | undefined {
  if (type !== 'service') return requested;

  if (requested) {
    throw new BadRequestException(SERVICE_BRAND_MESSAGE);
  }

  return currentBrandId ? null : undefined;
}

function toItemSupplierData(link: ItemSupplierDto) {
  return {
    supplierId: link.supplierId,
    supplierCode: link.supplierCode ?? null,
    purchasePrice:
      link.purchasePrice == null ? null : roundCurrency(link.purchasePrice),
    isMain: link.isMain ?? false,
  };
}

function toItemSupplierResponse({ supplier, ...link }: ItemSupplierRow) {
  return {
    supplierId: link.supplierId,
    name: supplier.name,
    active: supplier.active,
    supplierCode: link.supplierCode,
    purchasePrice: link.purchasePrice,
    isMain: link.isMain,
  };
}

function toItemDetail<T extends { suppliers: ItemSupplierRow[] }>(item: T) {
  return { ...item, suppliers: item.suppliers.map(toItemSupplierResponse) };
}
