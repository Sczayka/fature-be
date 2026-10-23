import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUniqueConstraintError } from '../../common/utils/prisma-errors.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  ENTRY_DIRECTION,
  FINANCIAL_CATEGORY_NOT_FOUND,
} from '../financial.constants.js';
import { FinancialSetupService } from '../setup/financial-setup.service.js';
import { CreateFinancialCategoryDto } from './dto/create-financial-category.dto.js';
import { ListFinancialCategoriesQueryDto } from './dto/list-financial-categories-query.dto.js';
import { UpdateFinancialCategoryDto } from './dto/update-financial-category.dto.js';

const CATEGORY_SELECT = {
  id: true,
  name: true,
  direction: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { entries: true } },
} satisfies Prisma.FinancialCategorySelect;

type CategoryRow = Prisma.FinancialCategoryGetPayload<{
  select: typeof CATEGORY_SELECT;
}>;

function toCategoryResponse({ _count, ...category }: CategoryRow) {
  return { ...category, entryCount: _count.entries };
}

function nameTaken(direction: string): string {
  return direction === ENTRY_DIRECTION.IN
    ? 'Já existe uma categoria de receita com este nome.'
    : 'Já existe uma categoria de despesa com este nome.';
}

/**
 * Categorias dos lançamentos: receitas e despesas. Categoria em uso não é excluída, é inativada:
 * some dos formulários, mas continua nos lançamentos que já a usam.
 */
@Injectable()
export class FinancialCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly setup: FinancialSetupService,
  ) {}

  /** Receitas e depois despesas, cada uma em ordem alfabética, com o número de lançamentos. */
  async findAll(
    organizationId: string,
    query: ListFinancialCategoriesQueryDto,
  ) {
    await this.setup.ensureSetup(organizationId);

    const categories = await this.prisma.financialCategory.findMany({
      where: {
        organizationId,
        ...(query.direction ? { direction: query.direction } : {}),
        ...(query.active !== undefined ? { active: query.active } : {}),
      },
      select: CATEGORY_SELECT,
      orderBy: [{ direction: 'asc' }, { name: 'asc' }],
    });

    return categories.map(toCategoryResponse);
  }

  async create(organizationId: string, dto: CreateFinancialCategoryDto) {
    await this.assertNameAvailable(organizationId, dto.direction, dto.name);

    try {
      const category = await this.prisma.financialCategory.create({
        data: {
          organizationId,
          name: dto.name,
          direction: dto.direction,
          active: dto.active ?? true,
        },
        select: CATEGORY_SELECT,
      });

      return toCategoryResponse(category);
    } catch (error) {
      throw isUniqueConstraintError(error)
        ? new ConflictException(nameTaken(dto.direction))
        : error;
    }
  }

  async update(
    id: string,
    organizationId: string,
    dto: UpdateFinancialCategoryDto,
  ) {
    const category = await this.findCategory(id, organizationId);

    if (dto.name !== undefined) {
      await this.assertNameAvailable(
        organizationId,
        category.direction,
        dto.name,
        id,
      );
    }

    try {
      const updated = await this.prisma.financialCategory.update({
        where: { id },
        data: { name: dto.name, active: dto.active },
        select: CATEGORY_SELECT,
      });

      return toCategoryResponse(updated);
    } catch (error) {
      throw isUniqueConstraintError(error)
        ? new ConflictException(nameTaken(category.direction))
        : error;
    }
  }

  /** Só sem lançamentos. */
  async remove(id: string, organizationId: string) {
    const category = await this.findCategory(id, organizationId);
    const entries = category._count.entries;

    if (entries > 0) {
      throw new ConflictException(
        `Esta categoria está em ${entries === 1 ? '1 lançamento' : `${entries} lançamentos`} e não pode ser excluída. Inative-a para que ela não apareça em novos lançamentos.`,
      );
    }

    await this.prisma.financialCategory.delete({ where: { id } });

    return toCategoryResponse(category);
  }

  private async findCategory(id: string, organizationId: string) {
    const category = await this.prisma.financialCategory.findFirst({
      where: { id, organizationId },
      select: CATEGORY_SELECT,
    });

    if (!category) {
      throw new NotFoundException(FINANCIAL_CATEGORY_NOT_FOUND);
    }

    return category;
  }

  /** Nome único entre as receitas ou entre as despesas, sem diferenciar maiúsculas. */
  private async assertNameAvailable(
    organizationId: string,
    direction: string,
    name: string,
    exceptId?: string,
  ) {
    const existing = await this.prisma.financialCategory.findFirst({
      where: {
        organizationId,
        direction,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { id: true },
    });

    if (existing) throw new ConflictException(nameTaken(direction));
  }
}
