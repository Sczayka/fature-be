import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paginationMeta } from '../../common/utils/pagination.js';
import {
  todayInBillingTimezone,
  utcMidnight,
} from '../../invoices/pricing/dates.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  assertAccount,
  assertCategory,
  assertClient,
  assertNotFuture,
} from '../entries/entry-references.js';
import { toEntryResponse } from '../entries/entry-response.js';
import { toAmount } from '../financial-balance.js';
import {
  ENTRY_DIRECTION,
  ENTRY_ORIGIN,
  ENTRY_STATUS,
  FINANCIAL_ENTRY_NOT_FOUND,
  FINANCIAL_ENTRY_SELECT,
  type EntryDirection,
} from '../financial.constants.js';
import { FinancialSetupService } from '../setup/financial-setup.service.js';
import { CreateReceiptDto } from './dto/create-receipt.dto.js';
import { ListReceiptsQueryDto } from './dto/list-receipts-query.dto.js';
import { UpdateReceiptDto } from './dto/update-receipt.dto.js';

/** O que a empresa muda num recebimento das faturas: o resto segue a movimentação. */
const INVOICE_RECEIPT_EDITABLE = ['accountId', 'categoryId', 'notes'];

const FUTURE_RECEIPT = 'A data do recebimento não pode ser futura';

const ZERO = new Prisma.Decimal(0);

type ReceiptFilters = Pick<
  ListReceiptsQueryDto,
  'from' | 'to' | 'accountId' | 'categoryId' | 'clientId' | 'origin' | 'q'
>;

/** Recebimentos: os das faturas (pagamentos e devoluções) e os lançados pela empresa. */
function receiptsWhere(
  organizationId: string,
  query: ReceiptFilters,
): Prisma.FinancialEntryWhereInput {
  const conditions: Prisma.FinancialEntryWhereInput[] = [
    {
      OR: [
        { origin: ENTRY_ORIGIN.INVOICE },
        { origin: ENTRY_ORIGIN.MANUAL, direction: ENTRY_DIRECTION.IN },
      ],
    },
  ];

  if (query.origin) conditions.push({ origin: query.origin });

  if (query.from || query.to) {
    conditions.push({
      paymentDate: {
        ...(query.from ? { gte: utcMidnight(query.from) } : {}),
        ...(query.to ? { lte: utcMidnight(query.to) } : {}),
      },
    });
  }

  if (query.accountId) conditions.push({ accountId: query.accountId });
  if (query.categoryId) conditions.push({ categoryId: query.categoryId });
  if (query.clientId) conditions.push({ clientId: query.clientId });

  if (query.q) {
    conditions.push({
      OR: [
        { description: { contains: query.q, mode: 'insensitive' } },
        { documentNumber: { contains: query.q, mode: 'insensitive' } },
        { client: { name: { contains: query.q, mode: 'insensitive' } } },
      ],
    });
  }

  return { organizationId, AND: conditions };
}

/**
 * Recebimentos do financeiro: as cópias das movimentações das faturas (InvoiceReceiptsService) e
 * o dinheiro recebido por fora, lançado pela empresa. Os das faturas só mudam a conta, a
 * categoria e a observação, e não são excluídos.
 */
@Injectable()
export class ReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly setup: FinancialSetupService,
  ) {}

  /** Do mais recente para o mais antigo, pela data do recebimento. */
  async findAll(organizationId: string, query: ListReceiptsQueryDto) {
    await this.setup.ensureSetup(organizationId);

    const { page, limit } = query;
    const where = receiptsWhere(organizationId, query);
    const today = todayInBillingTimezone();

    const [rows, totalItems] = await Promise.all([
      this.prisma.financialEntry.findMany({
        where,
        orderBy: [
          { paymentDate: 'desc' },
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
        select: FINANCIAL_ENTRY_SELECT,
      }),
      this.prisma.financialEntry.count({ where }),
    ]);

    return {
      data: rows.map((row) => toEntryResponse(row, today)),
      meta: paginationMeta(page, limit, totalItems),
    };
  }

  /**
   * Totais dos recebimentos do filtro, sem os cancelados: o bruto recebido, as taxas do provedor,
   * as devoluções e o líquido (o que ficou).
   */
  async totals(organizationId: string, query: ListReceiptsQueryDto) {
    const groups = await this.prisma.financialEntry.groupBy({
      by: ['direction'],
      where: {
        AND: [
          receiptsWhere(organizationId, query),
          { status: ENTRY_STATUS.PAID },
        ],
      },
      _count: { _all: true },
      _sum: { paidAmount: true, feeAmount: true },
    });
    const incoming = groups.find((row) => row.direction === ENTRY_DIRECTION.IN);
    const outgoing = groups.find(
      (row) => row.direction === ENTRY_DIRECTION.OUT,
    );
    const received = incoming?._sum.paidAmount ?? ZERO;
    const fees = incoming?._sum.feeAmount ?? ZERO;
    const refunded = outgoing?._sum.paidAmount ?? ZERO;

    return {
      count: groups.reduce((total, row) => total + row._count._all, 0),
      received: toAmount(received),
      fees: toAmount(fees),
      refunded: toAmount(refunded),
      net: toAmount(received.minus(fees).minus(refunded)),
    };
  }

  async create(organizationId: string, userId: string, dto: CreateReceiptDto) {
    assertNotFuture(dto.paymentDate, todayInBillingTimezone(), FUTURE_RECEIPT);
    await assertAccount(this.prisma, organizationId, dto.accountId);

    if (dto.categoryId) {
      await assertCategory(
        this.prisma,
        organizationId,
        dto.categoryId,
        ENTRY_DIRECTION.IN,
      );
    }

    if (dto.clientId) {
      await assertClient(this.prisma, organizationId, dto.clientId);
    }

    const paymentDate = utcMidnight(dto.paymentDate);
    const entry = await this.prisma.financialEntry.create({
      data: {
        organizationId,
        direction: ENTRY_DIRECTION.IN,
        origin: ENTRY_ORIGIN.MANUAL,
        status: ENTRY_STATUS.PAID,
        description: dto.description,
        amount: dto.amount,
        paidAmount: dto.amount,
        paymentDate,
        settlementDate: paymentDate,
        paymentMethod: dto.paymentMethod ?? null,
        accountId: dto.accountId,
        categoryId: dto.categoryId ?? null,
        clientId: dto.clientId ?? null,
        documentNumber: dto.documentNumber ?? null,
        notes: dto.notes ?? null,
        createdById: userId,
      },
      select: FINANCIAL_ENTRY_SELECT,
    });

    return toEntryResponse(entry, todayInBillingTimezone());
  }

  /** Campo ausente não muda nada; null limpa os opcionais. */
  async update(id: string, organizationId: string, dto: UpdateReceiptDto) {
    const receipt = await this.findReceipt(id, organizationId);

    if (receipt.origin === ENTRY_ORIGIN.INVOICE) {
      const locked = Object.entries(dto).some(
        ([field, value]) =>
          value !== undefined && !INVOICE_RECEIPT_EDITABLE.includes(field),
      );

      if (locked) {
        throw new BadRequestException(
          'Os recebimentos das faturas seguem as movimentações da fatura: aqui só mudam a conta, a categoria e a observação',
        );
      }
    }

    if (dto.paymentDate !== undefined) {
      assertNotFuture(
        dto.paymentDate,
        todayInBillingTimezone(),
        FUTURE_RECEIPT,
      );
    }

    if (dto.accountId !== undefined) {
      await assertAccount(
        this.prisma,
        organizationId,
        dto.accountId,
        receipt.accountId,
      );
    }

    if (dto.categoryId) {
      await assertCategory(
        this.prisma,
        organizationId,
        dto.categoryId,
        receipt.direction as EntryDirection,
        receipt.categoryId,
      );
    }

    if (dto.clientId) {
      await assertClient(
        this.prisma,
        organizationId,
        dto.clientId,
        receipt.clientId,
      );
    }

    const paymentDate =
      dto.paymentDate !== undefined ? utcMidnight(dto.paymentDate) : undefined;
    const entry = await this.prisma.financialEntry.update({
      where: { id },
      data: {
        description: dto.description,
        amount: dto.amount,
        paidAmount: dto.amount,
        paymentDate,
        settlementDate: paymentDate,
        paymentMethod: dto.paymentMethod,
        accountId: dto.accountId,
        categoryId: dto.categoryId,
        clientId: dto.clientId,
        documentNumber: dto.documentNumber,
        notes: dto.notes,
      },
      select: FINANCIAL_ENTRY_SELECT,
    });

    return toEntryResponse(entry, todayInBillingTimezone());
  }

  /** Só os lançados pela empresa. */
  async remove(id: string, organizationId: string) {
    const receipt = await this.findReceipt(id, organizationId);

    if (receipt.origin !== ENTRY_ORIGIN.MANUAL) {
      throw new ConflictException(
        'Os recebimentos das faturas não são excluídos: eles seguem as movimentações da fatura.',
      );
    }

    const entry = await this.prisma.financialEntry.delete({
      where: { id },
      select: FINANCIAL_ENTRY_SELECT,
    });

    return toEntryResponse(entry, todayInBillingTimezone());
  }

  private async findReceipt(id: string, organizationId: string) {
    const receipt = await this.prisma.financialEntry.findFirst({
      where: {
        AND: [{ id }, receiptsWhere(organizationId, {})],
      },
      select: {
        id: true,
        origin: true,
        direction: true,
        accountId: true,
        categoryId: true,
        clientId: true,
      },
    });

    if (!receipt) {
      throw new NotFoundException(FINANCIAL_ENTRY_NOT_FOUND);
    }

    return receipt;
  }
}
