import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { paginationMeta } from '../../common/utils/pagination.js';
import {
  todayInBillingTimezone,
  utcMidnight,
} from '../../invoices/pricing/dates.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  assertAccount,
  assertCategory,
  assertEmployee,
  assertNotFuture,
  assertSupplier,
  assertSupplierBankAccount,
  type ReferenceDb,
} from '../entries/entry-references.js';
import { toEntryResponse } from '../entries/entry-response.js';
import { toAmount } from '../financial-balance.js';
import {
  ENTRY_DIRECTION,
  ENTRY_STATUS,
  FINANCIAL_ENTRY_NOT_FOUND,
  FINANCIAL_ENTRY_SELECT,
  PAYABLE_ENTRY,
} from '../financial.constants.js';
import {
  competenceStart,
  monthEnd,
  monthStart,
  toCompetence,
} from '../financial-dates.js';
import { FinancialSetupService } from '../setup/financial-setup.service.js';
import { CreatePayableDto } from './dto/create-payable.dto.js';
import { PayableDeleteScope } from './dto/delete-payable-query.dto.js';
import { ListPayablesQueryDto } from './dto/list-payables-query.dto.js';
import { PayPayableDto } from './dto/pay-payable.dto.js';
import { UpdatePayableDto } from './dto/update-payable.dto.js';

const PAYABLE_STATE_SELECT = {
  id: true,
  status: true,
  accountId: true,
  categoryId: true,
  supplierId: true,
  supplierBankAccountId: true,
  employeeId: true,
  payrollType: true,
  competence: true,
  seriesId: true,
  seriesIndex: true,
} satisfies Prisma.FinancialEntrySelect;

type PayableState = Prisma.FinancialEntryGetPayload<{
  select: typeof PAYABLE_STATE_SELECT;
}>;

/** A quem pagar, a categoria e a conta, como ficam depois de salvar. */
interface PayableReferences {
  supplierId: string | null;
  supplierBankAccountId: string | null;
  employeeId: string | null;
  payrollType: string | null;
  competence: string | null;
  categoryId: string | null;
  accountId: string | null;
}

const NO_REFERENCES: PayableReferences = {
  supplierId: null,
  supplierBankAccountId: null,
  employeeId: null,
  payrollType: null,
  competence: null,
  categoryId: null,
  accountId: null,
};

const FUTURE_PAYMENT = 'A data do pagamento não pode ser futura';

function statusWhere(
  status: ListPayablesQueryDto['status'],
  startOfToday: Date,
): Prisma.FinancialEntryWhereInput {
  switch (status) {
    case 'PENDING':
      return { status: ENTRY_STATUS.PENDING };
    case 'OPEN':
      return { status: ENTRY_STATUS.PENDING, dueDate: { gte: startOfToday } };
    case 'OVERDUE':
      return { status: ENTRY_STATUS.PENDING, dueDate: { lt: startOfToday } };
    case 'PAID':
      return { status: ENTRY_STATUS.PAID };
    default:
      return {};
  }
}

/** Em aberto, a mais urgente primeiro; pagas, a mais recente; todas, pelo vencimento mais novo. */
function payablesOrder(
  status: ListPayablesQueryDto['status'],
): Prisma.FinancialEntryOrderByWithRelationInput[] {
  if (status === 'PAID') {
    return [{ paymentDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }];
  }

  return status
    ? [{ dueDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
    : [{ dueDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }];
}

/**
 * Contas a pagar: despesas com fornecedor, pagamentos da folha e avulsas, com categoria,
 * vencimento, parcelas ou recorrência mensal e a baixa. São lançamentos da empresa: podem ser
 * editados e excluídos a qualquer momento, e o pagamento pode ser desfeito.
 */
@Injectable()
export class PayablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly setup: FinancialSetupService,
  ) {}

  async findAll(organizationId: string, query: ListPayablesQueryDto) {
    await this.setup.ensureSetup(organizationId);

    const { page, limit } = query;
    const today = todayInBillingTimezone();
    const conditions: Prisma.FinancialEntryWhereInput[] = [
      statusWhere(query.status, utcMidnight(today)),
    ];
    const dateField = query.dateField ?? 'dueDate';

    if (query.from || query.to) {
      conditions.push({
        [dateField]: {
          ...(query.from ? { gte: utcMidnight(query.from) } : {}),
          ...(query.to ? { lte: utcMidnight(query.to) } : {}),
        },
      });
    }

    if (query.supplierId) conditions.push({ supplierId: query.supplierId });
    if (query.employeeId) conditions.push({ employeeId: query.employeeId });
    if (query.categoryId) conditions.push({ categoryId: query.categoryId });

    if (query.q) {
      const contains = { contains: query.q, mode: 'insensitive' } as const;

      conditions.push({
        OR: [
          { description: contains },
          { documentNumber: contains },
          { supplier: { name: contains } },
          { supplier: { tradeName: contains } },
          { employee: { name: contains } },
        ],
      });
    }

    const where: Prisma.FinancialEntryWhereInput = {
      organizationId,
      ...PAYABLE_ENTRY,
      AND: conditions,
    };

    const [rows, totalItems] = await Promise.all([
      this.prisma.financialEntry.findMany({
        where,
        orderBy: payablesOrder(query.status),
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

  /** Vencidas e a vencer (pelo valor da conta) e pagas no mês atual (pelo valor pago). */
  async totals(organizationId: string) {
    const today = todayInBillingTimezone();
    const startOfToday = utcMidnight(today);
    const base = { organizationId, ...PAYABLE_ENTRY };

    const [overdue, open, paid] = await Promise.all([
      this.prisma.financialEntry.aggregate({
        where: {
          ...base,
          status: ENTRY_STATUS.PENDING,
          dueDate: { lt: startOfToday },
        },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.financialEntry.aggregate({
        where: {
          ...base,
          status: ENTRY_STATUS.PENDING,
          dueDate: { gte: startOfToday },
        },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.financialEntry.aggregate({
        where: {
          ...base,
          status: ENTRY_STATUS.PAID,
          paymentDate: {
            gte: utcMidnight(monthStart(today)),
            lte: utcMidnight(monthEnd(today)),
          },
        },
        _count: { _all: true },
        _sum: { paidAmount: true },
      }),
    ]);

    const total = (value: Prisma.Decimal | null) =>
      value ? toAmount(value) : 0;

    return {
      overdue: {
        count: overdue._count._all,
        total: total(overdue._sum.amount),
      },
      open: { count: open._count._all, total: total(open._sum.amount) },
      paidThisMonth: {
        count: paid._count._all,
        total: total(paid._sum.paidAmount),
      },
    };
  }

  /** Contas vencidas e não pagas: o número no menu. */
  async overdueCount(organizationId: string) {
    const count = await this.prisma.financialEntry.count({
      where: {
        organizationId,
        ...PAYABLE_ENTRY,
        status: ENTRY_STATUS.PENDING,
        dueDate: { lt: utcMidnight(todayInBillingTimezone()) },
      },
    });

    return { count };
  }

  async findOne(id: string, organizationId: string) {
    const entry = await this.prisma.financialEntry.findFirst({
      where: { id, organizationId, ...PAYABLE_ENTRY },
      select: FINANCIAL_ENTRY_SELECT,
    });

    if (!entry) {
      throw new NotFoundException(FINANCIAL_ENTRY_NOT_FOUND);
    }

    return toEntryResponse(entry, todayInBillingTimezone());
  }

  /**
   * Uma conta para cada vencimento, todas na mesma transação; com mais de um, uma série numerada.
   * A conta única pode vir já paga.
   */
  async create(organizationId: string, userId: string, dto: CreatePayableDto) {
    const today = todayInBillingTimezone();
    const { installments, payment } = dto;
    const references: PayableReferences = {
      supplierId: dto.supplierId ?? null,
      supplierBankAccountId: dto.supplierBankAccountId ?? null,
      employeeId: dto.employeeId ?? null,
      payrollType: dto.payrollType ?? null,
      competence: dto.competence ?? null,
      categoryId: dto.categoryId ?? null,
      accountId: dto.accountId ?? null,
    };

    await this.assertReferences(
      this.prisma,
      organizationId,
      references,
      NO_REFERENCES,
    );

    if (payment) {
      if (installments.length > 1) {
        throw new BadRequestException(
          'Só a conta única pode ser lançada já paga: pague as parcelas uma a uma',
        );
      }

      assertNotFuture(payment.paymentDate, today, FUTURE_PAYMENT);
      await assertAccount(this.prisma, organizationId, payment.accountId);
    }

    const seriesId = installments.length > 1 ? randomUUID() : null;
    const paymentDate = payment ? utcMidnight(payment.paymentDate) : null;

    // Uma gravação por vez e só o id: a conexão da transação não aceita consultas simultâneas, e
    // o Prisma busca as relações do select em paralelo
    const ids = await this.prisma.$transaction(async (tx) => {
      const created: string[] = [];

      for (const [index, installment] of installments.entries()) {
        const { id } = await tx.financialEntry.create({
          data: {
            organizationId,
            ...PAYABLE_ENTRY,
            status: payment ? ENTRY_STATUS.PAID : ENTRY_STATUS.PENDING,
            description: dto.description,
            amount: installment.amount,
            dueDate: utcMidnight(installment.dueDate),
            paidAmount: payment?.paidAmount ?? null,
            paymentDate,
            settlementDate: paymentDate,
            paymentMethod: payment?.paymentMethod ?? dto.paymentMethod ?? null,
            accountId: payment?.accountId ?? references.accountId,
            categoryId: references.categoryId,
            documentNumber: dto.documentNumber ?? null,
            notes: dto.notes ?? null,
            supplierId: references.supplierId,
            supplierBankAccountId: references.supplierBankAccountId,
            employeeId: references.employeeId,
            payrollType: references.payrollType,
            competence: references.competence
              ? competenceStart(references.competence)
              : null,
            seriesId,
            seriesType: seriesId ? dto.seriesType : null,
            seriesIndex: seriesId ? index + 1 : null,
            seriesSize: seriesId ? installments.length : null,
            createdById: userId,
          },
          select: { id: true },
        });

        created.push(id);
      }

      return created;
    });

    const rows = await this.prisma.financialEntry.findMany({
      where: { id: { in: ids } },
      select: FINANCIAL_ENTRY_SELECT,
      orderBy: [{ seriesIndex: 'asc' }],
    });

    return rows.map((row) => toEntryResponse(row, today));
  }

  /** Só esta conta (as outras da série não mudam). Campo ausente não muda nada. */
  async update(id: string, organizationId: string, dto: UpdatePayableDto) {
    const payable = await this.findPayable(id, organizationId);
    const current = toReferences(payable);
    const supplierChanged =
      dto.supplierId !== undefined && dto.supplierId !== payable.supplierId;
    const references: PayableReferences = {
      supplierId: valueOf(dto.supplierId, current.supplierId),
      // A conta bancária é do fornecedor: trocado o fornecedor, ela sai se não vier outra
      supplierBankAccountId: valueOf(
        dto.supplierBankAccountId,
        supplierChanged ? null : current.supplierBankAccountId,
      ),
      employeeId: valueOf(dto.employeeId, current.employeeId),
      payrollType: valueOf(dto.payrollType, current.payrollType),
      competence: valueOf(dto.competence, current.competence),
      categoryId: valueOf(dto.categoryId, current.categoryId),
      accountId: valueOf(dto.accountId, current.accountId),
    };

    if (payable.status === ENTRY_STATUS.PAID && !references.accountId) {
      throw new BadRequestException(
        'A conta paga precisa da conta de onde saiu o dinheiro',
      );
    }

    await this.assertReferences(
      this.prisma,
      organizationId,
      references,
      current,
    );

    const entry = await this.prisma.financialEntry.update({
      where: { id },
      data: {
        description: dto.description,
        amount: dto.amount,
        dueDate:
          dto.dueDate !== undefined ? utcMidnight(dto.dueDate) : undefined,
        documentNumber: dto.documentNumber,
        paymentMethod: dto.paymentMethod,
        notes: dto.notes,
        ...references,
        competence: references.competence
          ? competenceStart(references.competence)
          : null,
      },
      select: FINANCIAL_ENTRY_SELECT,
    });

    return toEntryResponse(entry, todayInBillingTimezone());
  }

  /**
   * Exclui a conta (paga ou não: sai do caixa junto). Com FOLLOWING, também as próximas da série
   * ainda em aberto, o que encerra a recorrência. Devolve quantas foram excluídas.
   */
  async remove(
    id: string,
    organizationId: string,
    scope: PayableDeleteScope = 'THIS',
  ) {
    const payable = await this.findPayable(id, organizationId);
    const following =
      scope === 'FOLLOWING' && payable.seriesId
        ? await this.prisma.financialEntry.findMany({
            where: {
              organizationId,
              seriesId: payable.seriesId,
              seriesIndex: { gt: payable.seriesIndex ?? 0 },
              status: ENTRY_STATUS.PENDING,
            },
            select: { id: true },
          })
        : [];

    const { count } = await this.prisma.financialEntry.deleteMany({
      where: {
        organizationId,
        id: { in: [id, ...following.map((entry) => entry.id)] },
      },
    });

    return { count };
  }

  /** Baixa: o dinheiro sai da conta escolhida no dia do pagamento. */
  async pay(id: string, organizationId: string, dto: PayPayableDto) {
    const payable = await this.findPayable(id, organizationId);

    if (payable.status !== ENTRY_STATUS.PENDING) {
      throw new ConflictException('Esta conta já está paga.');
    }

    assertNotFuture(dto.paymentDate, todayInBillingTimezone(), FUTURE_PAYMENT);
    await assertAccount(this.prisma, organizationId, dto.accountId);

    const paymentDate = utcMidnight(dto.paymentDate);
    // Só baixa a que continua em aberto: duas baixas ao mesmo tempo não se sobrepõem
    const { count } = await this.prisma.financialEntry.updateMany({
      where: { id, status: ENTRY_STATUS.PENDING },
      data: {
        status: ENTRY_STATUS.PAID,
        paidAmount: dto.paidAmount,
        paymentDate,
        settlementDate: paymentDate,
        accountId: dto.accountId,
        ...(dto.paymentMethod !== undefined
          ? { paymentMethod: dto.paymentMethod }
          : {}),
      },
    });

    if (count === 0) {
      throw new ConflictException('Esta conta já está paga.');
    }

    return this.findOne(id, organizationId);
  }

  /** Desfaz a baixa: a conta volta a ficar em aberto e o dinheiro volta para o caixa. */
  async reopen(id: string, organizationId: string) {
    const payable = await this.findPayable(id, organizationId);

    if (payable.status !== ENTRY_STATUS.PAID) {
      throw new ConflictException('Esta conta não está paga.');
    }

    await this.prisma.financialEntry.updateMany({
      where: { id, status: ENTRY_STATUS.PAID },
      data: {
        status: ENTRY_STATUS.PENDING,
        paidAmount: null,
        paymentDate: null,
        settlementDate: null,
      },
    });

    return this.findOne(id, organizationId);
  }

  private async findPayable(
    id: string,
    organizationId: string,
  ): Promise<PayableState> {
    const payable = await this.prisma.financialEntry.findFirst({
      where: { id, organizationId, ...PAYABLE_ENTRY },
      select: PAYABLE_STATE_SELECT,
    });

    if (!payable) {
      throw new NotFoundException(FINANCIAL_ENTRY_NOT_FOUND);
    }

    return payable;
  }

  /**
   * A quem pagar (fornecedor ou funcionário, nunca os dois), a conta bancária do fornecedor, os
   * campos da folha, a categoria de despesa e a conta, todos da organização.
   */
  private async assertReferences(
    db: ReferenceDb,
    organizationId: string,
    references: PayableReferences,
    current: PayableReferences,
  ) {
    const { supplierId, supplierBankAccountId, employeeId } = references;

    if (supplierId && employeeId) {
      throw new BadRequestException(
        'Escolha um fornecedor ou um funcionário, não os dois',
      );
    }

    if (supplierBankAccountId && !supplierId) {
      throw new BadRequestException('Escolha o fornecedor da conta bancária');
    }

    if (employeeId && (!references.payrollType || !references.competence)) {
      throw new BadRequestException(
        'Informe o tipo do pagamento e o mês de referência da folha',
      );
    }

    if (!employeeId && (references.payrollType || references.competence)) {
      throw new BadRequestException(
        'O tipo do pagamento e o mês de referência são da folha: escolha o funcionário',
      );
    }

    if (supplierId) {
      await assertSupplier(db, organizationId, supplierId, current.supplierId);
    }

    if (supplierId && supplierBankAccountId) {
      await assertSupplierBankAccount(db, supplierId, supplierBankAccountId);
    }

    if (employeeId) {
      await assertEmployee(db, organizationId, employeeId, current.employeeId);
    }

    if (references.categoryId) {
      await assertCategory(
        db,
        organizationId,
        references.categoryId,
        ENTRY_DIRECTION.OUT,
        current.categoryId,
      );
    }

    if (references.accountId) {
      await assertAccount(
        db,
        organizationId,
        references.accountId,
        current.accountId,
      );
    }
  }
}

function toReferences(payable: PayableState): PayableReferences {
  return {
    supplierId: payable.supplierId,
    supplierBankAccountId: payable.supplierBankAccountId,
    employeeId: payable.employeeId,
    payrollType: payable.payrollType,
    competence: payable.competence ? toCompetence(payable.competence) : null,
    categoryId: payable.categoryId,
    accountId: payable.accountId,
  };
}

/** Valor enviado (null limpa) ou, ausente, o atual. */
function valueOf<T>(sent: T | null | undefined, current: T | null): T | null {
  return sent === undefined ? current : sent;
}
