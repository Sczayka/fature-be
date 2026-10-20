import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { instanceToPlain, plainToInstance } from 'class-transformer';
import { ValidationError, validate } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service.js';
import { paginationMeta, utcDayRange } from '../../common/utils/pagination.js';
import { CreateInvoiceDto } from '../dto/create-invoice.dto.js';
import { InvoicesService } from '../invoices.service.js';
import { CreateInvoiceDraftDto } from './dto/create-invoice-draft.dto.js';
import { ListInvoiceDraftsQueryDto } from './dto/list-invoice-drafts-query.dto.js';
import { UpdateInvoiceDraftDto } from './dto/update-invoice-draft.dto.js';
import { QUOTE_DOCUMENT_SELECT, toQuoteDocument } from './quote-document.js';
import { quotePdfFilename, renderQuotePdf } from './quote-pdf.js';

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

  async findAll(organizationId: string, query: ListInvoiceDraftsQueryDto) {
    const { page, limit } = query;
    const where: Prisma.InvoiceDraftWhereInput = { organizationId };

    if (query.createdAt) where.createdAt = utcDayRange(query.createdAt);
    // Só o orçamento ligado ao cliente cadastrado: o feito com cliente apenas digitado não tem id
    if (query.clientId) where.client = { path: ['id'], equals: query.clientId };

    const [data, totalItems] = await Promise.all([
      this.prisma.invoiceDraft.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.invoiceDraft.count({ where }),
    ]);

    return { data, meta: paginationMeta(page, limit, totalItems) };
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

  /** PDF do orçamento, o mesmo anexado ao e-mail: é a "página" da proposta para o cliente. */
  async renderPdf(
    id: string,
    organizationId: string,
  ): Promise<{ filename: string; content: Buffer }> {
    const draft = await this.prisma.invoiceDraft.findFirst({
      where: { id, organizationId },
      select: QUOTE_DOCUMENT_SELECT,
    });

    if (!draft) {
      throw new NotFoundException('Orçamento não encontrado');
    }

    const quote = toQuoteDocument(draft);

    if (quote.lines.length === 0) {
      throw new UnprocessableEntityException(
        'Adicione itens ao orçamento antes de gerar o PDF.',
      );
    }

    return {
      filename: quotePdfFilename(quote),
      content: await renderQuotePdf(quote),
    };
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
