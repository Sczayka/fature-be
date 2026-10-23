import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paginationMeta, utcDayRange } from '../../common/utils/pagination.js';
import { isUniqueConstraintError } from '../../common/utils/prisma-errors.js';
import { utcMidnight } from '../../invoices/pricing/dates.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { toAmount } from '../financial-balance.js';
import {
  EMPLOYEE_NOT_FOUND,
  EMPLOYEE_SEARCH_LIMIT,
} from '../financial.constants.js';
import { toDateOnlyOrNull } from '../financial-dates.js';
import { CreateEmployeeDto } from './dto/create-employee.dto.js';
import { ListEmployeesQueryDto } from './dto/list-employees-query.dto.js';
import { UpdateEmployeeDto } from './dto/update-employee.dto.js';

const EMPLOYEE_SELECT = {
  id: true,
  name: true,
  cpf: true,
  role: true,
  email: true,
  phone: true,
  admissionDate: true,
  salary: true,
  pixKeyType: true,
  pixKey: true,
  bankCode: true,
  bankName: true,
  branch: true,
  accountNumber: true,
  accountType: true,
  notes: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.EmployeeSelect;

type EmployeeRow = Prisma.EmployeeGetPayload<{
  select: typeof EMPLOYEE_SELECT;
}>;

const EMPLOYEE_SEARCH_SELECT = {
  id: true,
  name: true,
  role: true,
  salary: true,
  active: true,
} satisfies Prisma.EmployeeSelect;

const CPF_TAKEN = 'Já existe um funcionário com este CPF.';

const BANK_TRANSFER_FIELDS = [
  'bankCode',
  'branch',
  'accountNumber',
  'accountType',
] as const;

function toEmployeeResponse({
  salary,
  admissionDate,
  ...employee
}: EmployeeRow) {
  return {
    ...employee,
    salary: toAmount(salary),
    admissionDate: toDateOnlyOrNull(admissionDate),
  };
}

/** Colunas do funcionário; ausentes (undefined) não mudam. */
function toEmployeeData(dto: UpdateEmployeeDto) {
  return {
    name: dto.name,
    cpf: dto.cpf,
    role: dto.role,
    email: dto.email,
    phone: dto.phone,
    admissionDate:
      dto.admissionDate === undefined
        ? undefined
        : dto.admissionDate
          ? utcMidnight(dto.admissionDate)
          : null,
    salary: dto.salary,
    pixKeyType: dto.pixKeyType,
    pixKey: dto.pixKey,
    bankCode: dto.bankCode,
    bankName: dto.bankName,
    branch: dto.branch,
    accountNumber: dto.accountNumber,
    accountType: dto.accountType,
    notes: dto.notes,
    active: dto.active,
  };
}

/**
 * Funcionários da folha. Com pagamentos, o funcionário não é excluído, é inativado: sai da folha
 * gerada e dos seletores, mas continua nos pagamentos que já tem. Dados bancários e salário são
 * sensíveis: não vão para log.
 */
@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Em ordem alfabética. */
  async findAll(organizationId: string, query: ListEmployeesQueryDto) {
    const { page, limit } = query;
    const where: Prisma.EmployeeWhereInput = { organizationId };

    if (query.name) {
      where.OR = [
        { name: { contains: query.name, mode: 'insensitive' } },
        { role: { contains: query.name, mode: 'insensitive' } },
      ];
    }

    if (query.cpf) where.cpf = { contains: query.cpf };
    if (query.active !== undefined) where.active = query.active;
    if (query.createdAt) where.createdAt = utcDayRange(query.createdAt);

    const [rows, totalItems] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: EMPLOYEE_SELECT,
      }),
      this.prisma.employee.count({ where }),
    ]);

    return {
      data: rows.map(toEmployeeResponse),
      meta: paginationMeta(page, limit, totalItems),
    };
  }

  /** Seletores: só os ativos, por nome, cargo ou CPF; sem texto, os primeiros em ordem alfabética. */
  async search(organizationId: string, query: string) {
    const where: Prisma.EmployeeWhereInput = { organizationId, active: true };

    if (query) {
      const conditions: Prisma.EmployeeWhereInput[] = [
        { name: { contains: query, mode: 'insensitive' } },
        { role: { contains: query, mode: 'insensitive' } },
      ];

      // CPF digitado com ou sem a pontuação
      if (/^[\d\s.-]+$/.test(query)) {
        conditions.push({ cpf: { contains: query.replace(/\D/g, '') } });
      }

      where.OR = conditions;
    }

    const rows = await this.prisma.employee.findMany({
      where,
      select: EMPLOYEE_SEARCH_SELECT,
      orderBy: { name: 'asc' },
      take: EMPLOYEE_SEARCH_LIMIT,
    });

    return rows.map(({ salary, ...employee }) => ({
      ...employee,
      salary: toAmount(salary),
    }));
  }

  async findOne(id: string, organizationId: string) {
    return toEmployeeResponse(await this.findEmployee(id, organizationId));
  }

  async create(organizationId: string, dto: CreateEmployeeDto) {
    await this.assertCpfAvailable(organizationId, dto.cpf);

    try {
      const employee = await this.prisma.employee.create({
        data: {
          ...toEmployeeData(dto),
          name: dto.name,
          salary: dto.salary,
          organizationId,
        },
        select: EMPLOYEE_SELECT,
      });

      return toEmployeeResponse(employee);
    } catch (error) {
      throw toCpfConflict(error);
    }
  }

  /** Campo ausente não muda nada; null limpa os opcionais. */
  async update(id: string, organizationId: string, dto: UpdateEmployeeDto) {
    const current = await this.findEmployee(id, organizationId);

    await this.assertCpfAvailable(organizationId, dto.cpf, id);
    assertPaymentData({ ...current, ...withoutUndefined(dto) });

    try {
      const employee = await this.prisma.employee.update({
        where: { id },
        data: toEmployeeData(dto),
        select: EMPLOYEE_SELECT,
      });

      return toEmployeeResponse(employee);
    } catch (error) {
      throw toCpfConflict(error);
    }
  }

  /** Só sem pagamentos na folha. */
  async remove(id: string, organizationId: string) {
    const employee = await this.findEmployee(id, organizationId);
    const entries = await this.prisma.financialEntry.count({
      where: { employeeId: id },
    });

    if (entries > 0) {
      throw new ConflictException(
        `Este funcionário tem ${entries === 1 ? '1 pagamento' : `${entries} pagamentos`} na folha e não pode ser excluído. Inative-o para que ele não entre nas próximas folhas.`,
      );
    }

    await this.prisma.employee.delete({ where: { id } });

    return toEmployeeResponse(employee);
  }

  private async findEmployee(id: string, organizationId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id, organizationId },
      select: EMPLOYEE_SELECT,
    });

    if (!employee) {
      throw new NotFoundException(EMPLOYEE_NOT_FOUND);
    }

    return employee;
  }

  /** CPF único na organização; ausente ou vazio não é conferido. */
  private async assertCpfAvailable(
    organizationId: string,
    cpf: string | null | undefined,
    exceptId?: string,
  ) {
    if (!cpf) return;

    const existing = await this.prisma.employee.findFirst({
      where: {
        organizationId,
        cpf,
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { active: true },
    });

    if (!existing) return;

    throw new ConflictException(
      existing.active
        ? CPF_TAKEN
        : 'Já existe um funcionário inativo com este CPF: reative-o em vez de cadastrar outro.',
    );
  }
}

/** Na edição parcial, a conta bancária precisa sair completa: banco, agência, conta e tipo. */
function assertPaymentData(employee: Record<string, unknown>) {
  const filled = BANK_TRANSFER_FIELDS.filter(
    (field) => employee[field] != null,
  );

  if (filled.length > 0 && filled.length < BANK_TRANSFER_FIELDS.length) {
    throw new BadRequestException(
      'Informe banco, agência, conta e tipo juntos, ou nenhum deles',
    );
  }

  if ((employee.pixKeyType == null) !== (employee.pixKey == null)) {
    throw new BadRequestException('Informe o tipo e a chave Pix juntos');
  }
}

function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  ) as Partial<T>;
}

/** Outra requisição gravou o mesmo CPF entre a conferência e a escrita. */
function toCpfConflict(error: unknown) {
  return isUniqueConstraintError(error)
    ? new ConflictException(CPF_TAKEN)
    : error;
}
