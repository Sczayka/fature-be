import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { roundCurrency } from '../common/utils/currency.js';
import { paginationMeta, utcDayRange } from '../common/utils/pagination.js';
import { isUniqueConstraintError } from '../common/utils/prisma-errors.js';
import {
  todayInBillingTimezone,
  utcMidnight,
} from '../invoices/pricing/dates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePromotionDto } from './dto/create-promotion.dto.js';
import { ListPromotionsQueryDto } from './dto/list-promotions-query.dto.js';
import { UpdatePromotionDto } from './dto/update-promotion.dto.js';
import { toDateOnly, toIssuingPromotion } from './promotion-rules.js';
import {
  ISSUING_PROMOTION_SELECT,
  PROMOTION_DETAIL_SELECT,
  PROMOTION_LIST_SELECT,
  PROMOTION_NOT_FOUND,
} from './promotions.constants.js';

const PROMOTION_NAME_TAKEN = 'Já existe uma promoção com este nome.';

type PromotionListRow = Prisma.PromotionGetPayload<{
  select: typeof PROMOTION_LIST_SELECT;
}>;

type PromotionDetailRow = Prisma.PromotionGetPayload<{
  select: typeof PROMOTION_DETAIL_SELECT;
}>;

/**
 * Promoções e descontos pré-definidos dos itens. A etapa Desconto da nova cobrança oferece as
 * ativas e dentro da validade (`available`); a emissão confere a aplicada de novo e grava uma cópia
 * das regras, então editar ou inativar a promoção não muda cobranças emitidas.
 */
@Injectable()
export class PromotionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(organizationId: string, dto: CreatePromotionDto) {
    const startsAt = dto.startsAt || null;
    const endsAt = dto.endsAt || null;

    assertValidity(startsAt, endsAt);
    await this.assertNameAvailable(organizationId, dto.name);
    await this.assertItems(organizationId, dto.itemIds);

    try {
      const promotion = await this.prisma.promotion.create({
        data: {
          name: dto.name,
          type: dto.type,
          value: roundCurrency(dto.value),
          application: dto.application,
          maxAmount:
            dto.maxAmount == null ? null : roundCurrency(dto.maxAmount),
          maxQuantity: dto.maxQuantity ?? null,
          startsAt: startsAt && utcMidnight(startsAt),
          endsAt: endsAt && utcMidnight(endsAt),
          active: dto.active,
          organizationId,
          items: { create: dto.itemIds.map((itemId) => ({ itemId })) },
        },
        select: PROMOTION_DETAIL_SELECT,
      });

      return toPromotionDetail(promotion);
    } catch (error) {
      throw toNameConflict(error);
    }
  }

  async findAll(organizationId: string, query: ListPromotionsQueryDto) {
    const { page, limit } = query;
    const where: Prisma.PromotionWhereInput = { organizationId };

    if (query.name) where.name = { contains: query.name, mode: 'insensitive' };
    if (query.active !== undefined) where.active = query.active;
    if (query.createdAt) where.createdAt = utcDayRange(query.createdAt);

    const [rows, totalItems] = await Promise.all([
      this.prisma.promotion.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: PROMOTION_LIST_SELECT,
      }),
      this.prisma.promotion.count({ where }),
    ]);

    return {
      data: rows.map(toPromotionSummary),
      meta: paginationMeta(page, limit, totalItems),
    };
  }

  /**
   * Etapa Desconto da nova cobrança: as ativas e dentro da validade hoje que atendem a pelo menos
   * um dos itens, por nome. `itemIds` de cada uma traz só os itens consultados.
   */
  async available(organizationId: string, itemIds: string[]) {
    if (itemIds.length === 0) return [];

    const today = utcMidnight(todayInBillingTimezone());
    const promotions = await this.prisma.promotion.findMany({
      where: {
        organizationId,
        active: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: today } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: today } }] },
        ],
        items: { some: { itemId: { in: itemIds } } },
      },
      select: {
        ...ISSUING_PROMOTION_SELECT,
        items: {
          where: { itemId: { in: itemIds } },
          select: { itemId: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return promotions.map(toIssuingPromotion);
  }

  async findOne(id: string, organizationId: string) {
    const promotion = await this.prisma.promotion.findFirst({
      where: { id, organizationId },
      select: PROMOTION_DETAIL_SELECT,
    });

    if (!promotion) {
      throw new NotFoundException(PROMOTION_NOT_FOUND);
    }

    return toPromotionDetail(promotion);
  }

  /** Campo ausente não muda nada; `itemIds` substitui a lista inteira. */
  async update(id: string, organizationId: string, dto: UpdatePromotionDto) {
    const current = await this.prisma.promotion.findFirst({
      where: { id, organizationId },
      select: { type: true, value: true, startsAt: true, endsAt: true },
    });

    if (!current) {
      throw new NotFoundException(PROMOTION_NOT_FOUND);
    }

    const startsAt =
      dto.startsAt === undefined
        ? toDateOnly(current.startsAt)
        : dto.startsAt || null;
    const endsAt =
      dto.endsAt === undefined
        ? toDateOnly(current.endsAt)
        : dto.endsAt || null;

    assertValidity(startsAt, endsAt);

    // O DTO só limita o percentual quando tipo e valor vêm juntos
    if (
      (dto.type ?? current.type) === 'PERCENTAGE' &&
      (dto.value ?? current.value) > 100
    ) {
      throw new BadRequestException(
        'O desconto em porcentagem não pode passar de 100%',
      );
    }

    if (dto.name !== undefined) {
      await this.assertNameAvailable(organizationId, dto.name, id);
    }

    if (dto.itemIds !== undefined) {
      await this.assertItems(organizationId, dto.itemIds);
    }

    try {
      const promotion = await this.prisma.$transaction(async (tx) => {
        if (dto.itemIds !== undefined) {
          await tx.promotionItem.deleteMany({ where: { promotionId: id } });
        }

        return tx.promotion.update({
          where: { id },
          data: {
            name: dto.name,
            type: dto.type,
            value:
              dto.value === undefined ? undefined : roundCurrency(dto.value),
            application: dto.application,
            maxAmount:
              dto.maxAmount === undefined
                ? undefined
                : dto.maxAmount && roundCurrency(dto.maxAmount),
            maxQuantity: dto.maxQuantity,
            startsAt: startsAt && utcMidnight(startsAt),
            endsAt: endsAt && utcMidnight(endsAt),
            active: dto.active,
            items: dto.itemIds && {
              create: dto.itemIds.map((itemId) => ({ itemId })),
            },
          },
          select: PROMOTION_DETAIL_SELECT,
        });
      });

      return toPromotionDetail(promotion);
    } catch (error) {
      throw toNameConflict(error);
    }
  }

  /**
   * Só sem cobranças: a cobrança guarda uma cópia das regras, mas o id é o que diz de onde veio o
   * desconto. Os orçamentos que a usam são conferidos na conversão.
   */
  async remove(id: string, organizationId: string) {
    await this.findOne(id, organizationId);

    const invoices = await this.prisma.invoice.count({
      where: {
        organizationId,
        discount: { path: ['items'], array_contains: [{ promotion: { id } }] },
      },
    });

    if (invoices > 0) {
      throw new ConflictException(
        `Esta promoção foi usada em ${invoices === 1 ? '1 cobrança' : `${invoices} cobranças`} e não pode ser excluída. Inative-a para que ela não apareça em novas cobranças.`,
      );
    }

    return this.prisma.promotion.delete({ where: { id } });
  }

  private async assertNameAvailable(
    organizationId: string,
    name: string,
    exceptId?: string,
  ) {
    const existing = await this.prisma.promotion.findFirst({
      where: {
        organizationId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId && { NOT: { id: exceptId } }),
      },
      select: { active: true },
    });

    if (existing) {
      throw new ConflictException(
        existing.active
          ? PROMOTION_NAME_TAKEN
          : 'Já existe uma promoção inativa com este nome: reative-a em vez de cadastrar outra.',
      );
    }
  }

  /** Itens atendidos: todos da organização. */
  private async assertItems(organizationId: string, itemIds: string[]) {
    const found = await this.prisma.item.count({
      where: { id: { in: itemIds }, organizationId },
    });

    if (found !== itemIds.length) {
      throw new NotFoundException('Produto ou serviço não encontrado');
    }
  }
}

/** A validade termina no mesmo dia em que começa ou depois. */
function assertValidity(startsAt: string | null, endsAt: string | null) {
  if (startsAt && endsAt && endsAt < startsAt) {
    throw new BadRequestException(
      'O fim da validade não pode ser anterior ao início',
    );
  }
}

function toPromotionSummary({ _count, ...promotion }: PromotionListRow) {
  return {
    ...promotion,
    startsAt: toDateOnly(promotion.startsAt),
    endsAt: toDateOnly(promotion.endsAt),
    itemsCount: _count.items,
  };
}

function toPromotionDetail({ items, ...promotion }: PromotionDetailRow) {
  return {
    ...promotion,
    startsAt: toDateOnly(promotion.startsAt),
    endsAt: toDateOnly(promotion.endsAt),
    items: items.map((link) => link.item),
  };
}

/** Outra requisição gravou o mesmo nome entre a conferência e a escrita. */
function toNameConflict(error: unknown) {
  return isUniqueConstraintError(error)
    ? new ConflictException(PROMOTION_NAME_TAKEN)
    : error;
}
