import { Prisma } from '@prisma/client';
import { PayrollService } from './payroll.service.js';

vi.mock('../../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

const decimal = (value: number) => new Prisma.Decimal(value);

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'salary-ana',
    direction: 'OUT',
    origin: 'MANUAL',
    status: 'PENDING',
    description: 'Salário 10/2026',
    amount: decimal(3000),
    dueDate: new Date('2026-11-05T00:00:00Z'),
    paidAmount: null,
    feeAmount: decimal(0),
    paymentDate: null,
    settlementDate: null,
    paymentMethod: null,
    account: null,
    category: null,
    documentNumber: null,
    notes: null,
    supplier: null,
    supplierBankAccountId: null,
    employee: { id: 'employee-ana', name: 'Ana' },
    payrollType: 'SALARY',
    competence: new Date('2026-10-01T00:00:00Z'),
    seriesId: null,
    seriesType: null,
    seriesIndex: null,
    seriesSize: null,
    invoiceId: null,
    client: null,
    transferId: null,
    createdBy: null,
    createdAt: new Date('2026-10-20T12:00:00Z'),
    updatedAt: new Date('2026-10-20T12:00:00Z'),
    ...overrides,
  };
}

describe('PayrollService', () => {
  let prisma: any;
  let service: PayrollService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T15:00:00Z'));

    prisma = {
      financialEntry: {
        findMany: vi.fn().mockResolvedValue([]),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      employee: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'employee-ana',
            name: 'Ana',
            role: 'Vendas',
            salary: decimal(3000),
          },
          {
            id: 'employee-bia',
            name: 'Bia',
            role: null,
            salary: decimal(2500),
          },
        ]),
      },
      financialAccount: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'acc-bank', name: 'Banco', active: true }),
      },
      financialCategory: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'cat-salaries',
          name: 'Salários e encargos',
          direction: 'OUT',
          active: true,
        }),
      },
      $executeRaw: vi.fn().mockResolvedValue(1),
      $transaction: vi.fn().mockImplementation((work) => work(prisma)),
    };
    service = new PayrollService(prisma, {
      ensureSetup: vi.fn().mockResolvedValue(undefined),
    } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the payments of the month, the totals and who still has no salary', async () => {
    prisma.financialEntry.findMany.mockResolvedValue([
      entry({
        status: 'PAID',
        paidAmount: decimal(3000),
        paymentDate: new Date('2026-11-05T00:00:00Z'),
        settlementDate: new Date('2026-11-05T00:00:00Z'),
      }),
      entry({
        id: 'advance-bia',
        payrollType: 'ADVANCE',
        amount: decimal(1000),
        employee: { id: 'employee-bia', name: 'Bia' },
      }),
    ]);

    const result = await service.findMonth('org-1', { competence: '2026-10' });

    expect(prisma.financialEntry.findMany.mock.calls[0][0].where).toMatchObject(
      {
        organizationId: 'org-1',
        employeeId: { not: null },
        competence: new Date('2026-10-01T00:00:00Z'),
      },
    );
    expect(result.competence).toBe('2026-10');
    expect(result.totals).toEqual({
      count: 2,
      paid: 3000,
      pending: 1000,
      total: 4000,
    });
    // O adiantamento não conta como o salário do mês
    expect(result.employeesWithoutSalary).toEqual([
      { id: 'employee-bia', name: 'Bia', role: null, salary: 2500 },
    ]);
    expect(result.entries[0]).toMatchObject({ competence: '2026-10' });
  });

  it('uses the current month by default', async () => {
    await expect(service.findMonth('org-1', {})).resolves.toMatchObject({
      competence: '2026-10',
    });
  });

  it('generates the salary of the active employees that do not have it yet', async () => {
    prisma.financialEntry.findMany.mockResolvedValue([
      { employeeId: 'employee-ana' },
    ]);

    await expect(
      service.generate('org-1', 'user-1', {
        competence: '2026-10',
        dueDate: '2026-11-05',
        categoryId: 'cat-salaries',
        accountId: 'acc-bank',
      }),
    ).resolves.toEqual({ created: 1 });

    expect(prisma.$executeRaw.mock.calls[0].slice(1)).toEqual([
      'payroll:org-1:2026-10',
    ]);
    expect(prisma.employee.findMany.mock.calls[0][0].where).toEqual({
      organizationId: 'org-1',
      active: true,
      salary: { gt: 0 },
    });
    expect(prisma.financialEntry.createMany.mock.calls[0][0].data).toEqual([
      {
        organizationId: 'org-1',
        origin: 'MANUAL',
        direction: 'OUT',
        status: 'PENDING',
        description: 'Salário 10/2026',
        amount: decimal(2500),
        dueDate: new Date('2026-11-05T00:00:00Z'),
        employeeId: 'employee-bia',
        payrollType: 'SALARY',
        competence: new Date('2026-10-01T00:00:00Z'),
        categoryId: 'cat-salaries',
        accountId: 'acc-bank',
        createdById: 'user-1',
      },
    ]);
  });

  it('creates nothing when everyone already has the salary of the month', async () => {
    prisma.financialEntry.findMany.mockResolvedValue([
      { employeeId: 'employee-ana' },
      { employeeId: 'employee-bia' },
    ]);

    await expect(
      service.generate('org-1', 'user-1', {
        competence: '2026-10',
        dueDate: '2026-11-05',
      }),
    ).resolves.toEqual({ created: 0 });
    expect(prisma.financialEntry.createMany).not.toHaveBeenCalled();
  });
});
