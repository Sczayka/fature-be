import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { instanceToPlain, plainToInstance } from 'class-transformer';
import { ValidationError, validate } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateInvoiceDto } from '../dto/create-invoice.dto.js';
import { InvoicesService } from '../invoices.service.js';
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
 * Orçamentos de cobrança. Apenas persistência: não gera boleto/PIX/cartão e não chama o
 * gateway de pagamento. O envio ao cliente por e-mail fica em src/email/quotes.
 */
@Injectable()
export class InvoiceDraftsService {
  private readonly logger = new Logger(InvoiceDraftsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicesService: InvoicesService,
  ) {}

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

  /**
   * Transforma o orçamento em cobrança real: o orçamento salvo passa pelas mesmas
   * validações e regras de emissão de POST /invoices e, emitida a cobrança, é removido.
   */
  async convertToInvoice(id: string, organizationId: string) {
    const draft = await this.findOne(id, organizationId);

    const dto = plainToInstance(CreateInvoiceDto, {
      client: draft.client,
      items: draft.items,
      billing: draft.billing,
      paymentMethods: draft.paymentMethods,
      discount: draft.discount ?? undefined,
      interestAndFine: draft.interestAndFine ?? undefined,
    });

    const errors = await validate(dto, { whitelist: true });

    if (errors.length > 0) {
      const details = this.flattenValidationErrors(errors);

      throw new BadRequestException({
        message: `Orçamento incompleto: ${details[0]}`,
        details,
      });
    }

    const invoice = await this.invoicesService.create(organizationId, dto);

    try {
      await this.prisma.invoiceDraft.delete({ where: { id } });
    } catch (error) {
      // A cobrança já foi emitida: falhar aqui faria o usuário emitir de novo
      this.logger.error(
        `Invoice ${invoice.id} created but draft ${id} was not removed`,
        error,
      );
    }

    return invoice;
  }

  private flattenValidationErrors(
    errors: ValidationError[],
    parentPath = '',
  ): string[] {
    return errors.flatMap((error) => {
      const path = parentPath
        ? `${parentPath}.${error.property}`
        : error.property;

      return [
        ...Object.values(error.constraints ?? {}).map(
          (message) => `${path}: ${message}`,
        ),
        ...this.flattenValidationErrors(error.children ?? [], path),
      ];
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
