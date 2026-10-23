import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  todayInBillingTimezone,
  utcMidnight,
} from '../../invoices/pricing/dates.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { assertAccount, assertCategory } from '../entries/entry-references.js';
import { toEntryResponse } from '../entries/entry-response.js';
import { toAmount } from '../financial-balance.js';
import {
  ENTRY_DIRECTION,
  ENTRY_STATUS,
  FINANCIAL_ENTRY_SELECT,
  PAYABLE_ENTRY,
  PAYROLL_TYPE_LABELS,
} from '../financial.constants.js';
import { competenceStart, formatCompetence } from '../financial-dates.js';
import { FinancialSetupService } from '../setup/financial-setup.service.js';
import { GeneratePayrollDto } from './dto/generate-payroll.dto.js';
import { PayrollQueryDto } from './dto/payroll-query.dto.js';

const ZERO = new Prisma.Decimal(0);

/**
 * Folha de pagamento: os pagamentos dos funcionários (salário, adiantamento, 13º, férias, bônus e
 * outros) são contas a pagar com o funcionário e o mês de referência. Aqui ficam a visão do mês
 * e a geração dos salários; a baixa e a edição são as das contas a pagar. Os encargos (INSS,
 * FGTS e IRRF) não são calculados.
 */
@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly setup: FinancialSetupService,
  ) {}

  /**
   * A folha do mês (sem ele, o atual): os pagamentos lançados, por funcionário, os totais e os
   * funcionários ativos ainda sem o salário do mês.
   */
  async findMonth(organizationId: string, query: PayrollQueryDto) {
    await this.setup.ensureSetup(organizationId);

    const today = todayInBillingTimezone();
    const competence = query.competence ?? today.slice(0, 7);

    const [rows, employees] = await Promise.all([
      this.prisma.financialEntry.findMany({
        where: {
          organizationId,
          ...PAYABLE_ENTRY,
          employeeId: { not: null },
          competence: competenceStart(competence),
        },
        select: FINANCIAL_ENTRY_SELECT,
        orderBy: [
          { employee: { name: 'asc' } },
          { dueDate: 'asc' },
          { createdAt: 'asc' },
        ],
      }),
      this.prisma.employee.findMany({
        where: { organizationId, active: true },
        select: { id: true, name: true, role: true, salary: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    const withSalary = new Set(
      rows
        .filter((row) => row.payrollType === 'SALARY')
        .map((row) => row.employee?.id),
    );
    const paid = rows
      .filter((row) => row.status === ENTRY_STATUS.PAID)
      .reduce((total, row) => total.plus(row.paidAmount ?? ZERO), ZERO);
    const pending = rows
      .filter((row) => row.status === ENTRY_STATUS.PENDING)
      .reduce((total, row) => total.plus(row.amount), ZERO);

    return {
      competence,
      entries: rows.map((row) => toEntryResponse(row, today)),
      employeesWithoutSalary: employees
        .filter((employee) => !withSalary.has(employee.id))
        .map(({ salary, ...employee }) => ({
          ...employee,
          salary: toAmount(salary),
        })),
      totals: {
        count: rows.length,
        paid: toAmount(paid),
        pending: toAmount(pending),
        total: toAmount(paid.plus(pending)),
      },
    };
  }

  /**
   * Um salário em aberto para cada funcionário ativo com salário que ainda não tem o do mês, todos
   * com o mesmo vencimento. Pode rodar de novo (ex.: depois de admitir alguém): os que já têm
   * ficam como estão. Devolve quantos foram criados.
   */
  async generate(
    organizationId: string,
    userId: string,
    dto: GeneratePayrollDto,
  ) {
    if (dto.categoryId) {
      await assertCategory(
        this.prisma,
        organizationId,
        dto.categoryId,
        ENTRY_DIRECTION.OUT,
      );
    }

    if (dto.accountId) {
      await assertAccount(this.prisma, organizationId, dto.accountId);
    }

    const competence = competenceStart(dto.competence);

    const created = await this.prisma.$transaction(async (tx) => {
      // Duas gerações do mesmo mês ao mesmo tempo não duplicam os salários
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payroll:${organizationId}:${dto.competence}`}))`;

      // Uma consulta por vez: a conexão da transação não aceita consultas simultâneas
      const employees = await tx.employee.findMany({
        where: { organizationId, active: true, salary: { gt: 0 } },
        select: { id: true, salary: true },
      });
      const existing = await tx.financialEntry.findMany({
        where: {
          organizationId,
          ...PAYABLE_ENTRY,
          competence,
          payrollType: 'SALARY',
          employeeId: { not: null },
        },
        select: { employeeId: true },
      });
      const withSalary = new Set(existing.map((entry) => entry.employeeId));
      const missing = employees.filter(
        (employee) => !withSalary.has(employee.id),
      );

      if (missing.length === 0) return 0;

      await tx.financialEntry.createMany({
        data: missing.map((employee) => ({
          organizationId,
          ...PAYABLE_ENTRY,
          status: ENTRY_STATUS.PENDING,
          description: `${PAYROLL_TYPE_LABELS.SALARY} ${formatCompetence(dto.competence)}`,
          amount: employee.salary,
          dueDate: utcMidnight(dto.dueDate),
          employeeId: employee.id,
          payrollType: 'SALARY',
          competence,
          categoryId: dto.categoryId ?? null,
          accountId: dto.accountId ?? null,
          createdById: userId,
        })),
      });

      return missing.length;
    });

    return { created };
  }
}
