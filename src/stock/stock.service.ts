import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ListQueryDto } from '../common/dto/list-query.dto.js';
import { paginationMeta, utcDayRange } from '../common/utils/pagination.js';
import {
  ITEM_NOT_FOUND,
  SERVICE_STOCK_MESSAGE,
} from '../items/items.constants.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateStockMovementDto } from './dto/create-stock-movement.dto.js';
import {
  INITIAL_STOCK_NOTE,
  STOCK_MOVEMENT_SELECT,
  STOCK_MOVEMENT_TYPE,
} from './stock.constants.js';

interface LockedItem {
  id: string;
  type: string;
  stock: number;
}

export interface SaleLine {
  /** Id do item na cópia guardada pela cobrança. */
  id: string;
  quantity: number;
}

export interface Sale {
  organizationId: string;
  invoiceId: string;
  userId: string;
  lines: SaleLine[];
}

/**
 * Estoque dos produtos: o saldo (Item.stock) só muda pelas movimentações, gravadas junto com ele
 * na mesma transação. As linhas dos itens ficam travadas até o commit, então vendas e ajustes
 * simultâneos do mesmo produto esperam a vez e nenhuma baixa se perde.
 */
@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  /** Histórico do produto, da movimentação mais recente para a mais antiga. */
  async findMovements(
    itemId: string,
    organizationId: string,
    query: ListQueryDto,
  ) {
    const { page, limit } = query;
    const item = await this.prisma.item.findFirst({
      where: { id: itemId, organizationId },
      select: { id: true },
    });

    if (!item) {
      throw new NotFoundException(ITEM_NOT_FOUND);
    }

    const where: Prisma.StockMovementWhereInput = { itemId };

    if (query.createdAt) where.createdAt = utcDayRange(query.createdAt);

    const [data, totalItems] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: STOCK_MOVEMENT_SELECT,
      }),
      this.prisma.stockMovement.count({ where }),
    ]);

    return { data, meta: paginationMeta(page, limit, totalItems) };
  }

  /** Entrada, devolução ou ajuste lançado pela empresa. */
  async createMovement(
    itemId: string,
    organizationId: string,
    userId: string,
    dto: CreateStockMovementDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const [item] = await this.lockItems(tx, organizationId, [itemId]);

      if (!item) {
        throw new NotFoundException(ITEM_NOT_FOUND);
      }

      if (item.type !== 'product') {
        throw new BadRequestException(SERVICE_STOCK_MESSAGE);
      }

      const quantity =
        dto.type === STOCK_MOVEMENT_TYPE.ADJUSTMENT
          ? dto.balance! - item.stock
          : dto.quantity!;

      if (quantity === 0) {
        throw new BadRequestException(
          `O saldo contado é o mesmo do estoque (${item.stock}): não há o que ajustar`,
        );
      }

      const balance = item.stock + quantity;

      await tx.item.update({ where: { id: itemId }, data: { stock: balance } });

      return tx.stockMovement.create({
        data: {
          itemId,
          type: dto.type,
          quantity,
          balance,
          notes: dto.notes ?? null,
          createdById: userId,
        },
        select: STOCK_MOVEMENT_SELECT,
      });
    });
  }

  /** Estoque informado no cadastro do produto: a primeira entrada do histórico. */
  async recordInitialStock(
    tx: Prisma.TransactionClient,
    itemId: string,
    quantity: number,
    userId: string,
  ) {
    await tx.stockMovement.create({
      data: {
        itemId,
        type: STOCK_MOVEMENT_TYPE.ENTRY,
        quantity,
        balance: quantity,
        notes: INITIAL_STOCK_NOTE,
        createdById: userId,
      },
    });
  }

  /**
   * Baixa da cobrança emitida, na transação que grava a fatura: uma venda por produto, com a soma
   * das linhas dele. Serviços e itens que não são (mais) da organização ficam de fora, já que a
   * cobrança guarda a cópia deles. Faltar estoque não impede a venda: o saldo fica negativo.
   */
  async recordSale(
    tx: Prisma.TransactionClient,
    { organizationId, invoiceId, userId, lines }: Sale,
  ) {
    const quantities = new Map<string, number>();

    for (const line of lines) {
      quantities.set(line.id, (quantities.get(line.id) ?? 0) + line.quantity);
    }

    if (quantities.size === 0) return;

    const items = await this.lockItems(tx, organizationId, [
      ...quantities.keys(),
    ]);
    const sales: Prisma.StockMovementCreateManyInput[] = [];

    for (const item of items) {
      if (item.type !== 'product') continue;

      const quantity = -quantities.get(item.id)!;
      const balance = item.stock + quantity;

      await tx.item.update({
        where: { id: item.id },
        data: { stock: balance },
      });
      sales.push({
        itemId: item.id,
        type: STOCK_MOVEMENT_TYPE.SALE,
        quantity,
        balance,
        invoiceId,
        createdById: userId,
      });
    }

    if (sales.length > 0) await tx.stockMovement.createMany({ data: sales });
  }

  /**
   * Desfaz a baixa da cobrança que não chegou a ser emitida (o boleto falhou): o saldo volta e as
   * vendas saem do histórico. O saldo gravado nas movimentações feitas nesse meio-tempo não muda.
   */
  async undoSale(tx: Prisma.TransactionClient, invoiceId: string) {
    const sales = await tx.stockMovement.findMany({
      where: { invoiceId, type: STOCK_MOVEMENT_TYPE.SALE },
      select: { itemId: true, quantity: true },
      orderBy: { itemId: 'asc' },
    });

    for (const sale of sales) {
      await tx.item.update({
        where: { id: sale.itemId },
        data: { stock: { increment: -sale.quantity } },
      });
    }

    await tx.stockMovement.deleteMany({
      where: { invoiceId, type: STOCK_MOVEMENT_TYPE.SALE },
    });
  }

  /**
   * Tipo e saldo dos itens da organização, com as linhas travadas até o fim da transação. A ordem
   * por id evita o deadlock entre duas cobranças com os mesmos produtos.
   */
  private lockItems(
    tx: Prisma.TransactionClient,
    organizationId: string,
    itemIds: string[],
  ): Promise<LockedItem[]> {
    return tx.$queryRaw<LockedItem[]>`
      SELECT "id", "type", "stock" FROM "Item"
      WHERE "organizationId" = ${organizationId} AND "id" IN (${Prisma.join(itemIds)})
      ORDER BY "id"
      FOR UPDATE`;
  }
}
