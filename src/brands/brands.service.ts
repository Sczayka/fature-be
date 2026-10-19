import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paginationMeta, utcDayRange } from '../common/utils/pagination.js';
import { isUniqueConstraintError } from '../common/utils/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BRAND_NOT_FOUND, BRAND_SEARCH_LIMIT } from './brands.constants.js';
import { CreateBrandDto } from './dto/create-brand.dto.js';
import { ListBrandsQueryDto } from './dto/list-brands-query.dto.js';
import { UpdateBrandDto } from './dto/update-brand.dto.js';

const BRAND_NAME_TAKEN = 'Já existe uma marca com este nome.';

/**
 * Marcas dos produtos da organização. Marca em uso não é excluída, é inativada: some do seletor e
 * da busca, mas continua nos produtos que já a usam.
 */
@Injectable()
export class BrandsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(organizationId: string, dto: CreateBrandDto) {
    await this.assertNameAvailable(organizationId, dto.name);

    try {
      return await this.prisma.brand.create({
        data: { name: dto.name, active: dto.active, organizationId },
      });
    } catch (error) {
      throw toNameConflict(error);
    }
  }

  async findAll(organizationId: string, query: ListBrandsQueryDto) {
    const { page, limit } = query;
    const where: Prisma.BrandWhereInput = { organizationId };

    if (query.name) where.name = { contains: query.name, mode: 'insensitive' };
    if (query.active !== undefined) where.active = query.active;
    if (query.createdAt) where.createdAt = utcDayRange(query.createdAt);

    const [data, totalItems] = await Promise.all([
      this.prisma.brand.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.brand.count({ where }),
    ]);

    return { data, meta: paginationMeta(page, limit, totalItems) };
  }

  /** Seletores: só as ativas, por nome; sem texto, as primeiras em ordem alfabética. */
  search(organizationId: string, query: string) {
    return this.prisma.brand.findMany({
      where: {
        organizationId,
        active: true,
        name: { contains: query, mode: 'insensitive' },
      },
      select: { id: true, name: true, active: true },
      orderBy: { name: 'asc' },
      take: BRAND_SEARCH_LIMIT,
    });
  }

  async findOne(id: string, organizationId: string) {
    const brand = await this.prisma.brand.findFirst({
      where: { id, organizationId },
    });

    if (!brand) {
      throw new NotFoundException(BRAND_NOT_FOUND);
    }

    return brand;
  }

  async update(id: string, organizationId: string, dto: UpdateBrandDto) {
    await this.findOne(id, organizationId);

    if (dto.name !== undefined) {
      await this.assertNameAvailable(organizationId, dto.name, id);
    }

    try {
      return await this.prisma.brand.update({
        where: { id },
        data: { name: dto.name, active: dto.active },
      });
    } catch (error) {
      throw toNameConflict(error);
    }
  }

  /** Só sem produtos; os vínculos com fornecedores vão junto. */
  async remove(id: string, organizationId: string) {
    await this.findOne(id, organizationId);

    const products = await this.prisma.item.count({ where: { brandId: id } });

    if (products > 0) {
      throw new ConflictException(
        `Esta marca está em ${products === 1 ? '1 produto' : `${products} produtos`} e não pode ser excluída. Inative-a para que ela não apareça em novos cadastros.`,
      );
    }

    return this.prisma.brand.delete({ where: { id } });
  }

  private async assertNameAvailable(
    organizationId: string,
    name: string,
    exceptId?: string,
  ) {
    const existing = await this.prisma.brand.findFirst({
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
          ? BRAND_NAME_TAKEN
          : 'Já existe uma marca inativa com este nome: reative-a em vez de cadastrar outra.',
      );
    }
  }
}

/** Outra requisição gravou o mesmo nome entre a conferência e a escrita. */
function toNameConflict(error: unknown) {
  return isUniqueConstraintError(error)
    ? new ConflictException(BRAND_NAME_TAKEN)
    : error;
}
