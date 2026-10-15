import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { instanceToPlain } from 'class-transformer';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateInvoiceDraftDto } from './dto/create-invoice-draft.dto.js';
import { UpdateInvoiceDraftDto } from './dto/update-invoice-draft.dto.js';

type DraftSections = Pick<
  Prisma.InvoiceDraftUncheckedCreateInput,
  | 'client'
  | 'items'
  | 'billing'
  | 'paymentMethods'
  | 'discount'
  | 'interestAndFine'
>;

/**
 * Orçamentos de cobrança. Apenas persistência: não gera boleto/PIX/cartão, não chama o
 * gateway de pagamento e não dispara e-mails.
 */
@Injectable()
export class InvoiceDraftsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(organizationId: string, dto: CreateInvoiceDraftDto) {
    return this.prisma.invoiceDraft.create({
      data: {
        ...this.toDraftData(dto),
        organizationId,
      },
    });
  }

  async findAll(
    organizationId: string,
    page: number = 1,
    limit: number = 10,
    filters?: { createdAt?: string },
  ) {
    const skip = (page - 1) * limit;

    const where: any = { organizationId };

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
      this.prisma.invoiceDraft.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.invoiceDraft.count({
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

  async findOne(id: string, organizationId: string) {
    const draft = await this.prisma.invoiceDraft.findFirst({
      where: { id, organizationId },
    });

    if (!draft) {
      throw new NotFoundException('Orçamento não encontrado');
    }

    return draft;
  }

  async update(id: string, organizationId: string, dto: UpdateInvoiceDraftDto) {
    await this.findOne(id, organizationId);

    return this.prisma.invoiceDraft.update({
      where: { id },
      data: this.toDraftData(dto),
    });
  }

  async remove(id: string, organizationId: string) {
    await this.findOne(id, organizationId);

    return this.prisma.invoiceDraft.delete({
      where: { id },
    });
  }

  /** Seções enviadas substituem as salvas; seções ausentes não são alteradas. */
  private toDraftData(dto: UpdateInvoiceDraftDto) {
    const data: DraftSections = {};

    if (dto.client !== undefined) data.client = this.toNullableJson(dto.client);
    if (dto.items !== undefined) data.items = this.toJson(dto.items ?? []);
    if (dto.billing !== undefined)
      data.billing = this.toNullableJson(dto.billing);
    if (dto.paymentMethods !== undefined)
      data.paymentMethods = dto.paymentMethods ?? [];
    if (dto.discount !== undefined)
      data.discount = this.toNullableJson(dto.discount);
    if (dto.interestAndFine !== undefined)
      data.interestAndFine = this.toNullableJson(dto.interestAndFine);

    return data;
  }

  private toJson(value: object) {
    return instanceToPlain(value) as Prisma.InputJsonValue;
  }

  private toNullableJson(value: object | null) {
    return value === null ? Prisma.DbNull : this.toJson(value);
  }
}
