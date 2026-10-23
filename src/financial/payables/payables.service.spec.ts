import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PayablesService } from './payables.service.js';

vi.mock('../../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

const decimal = (value: number) => new Prisma.Decimal(value);

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payable-1',
    direction: 'OUT',
    origin: 'MANUAL',
    status: 'PENDING',
    description: 'Aluguel',
    amount: decimal(2000),
    dueDate: new Date('2026-10-10T00:00:00Z'),
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
    employee: null,
    payrollType: null,
    competence: null,
    seriesId: null,
    seriesType: null,
    seriesIndex: null,
    seriesSize: null,
    invoiceId: null,
    client: null,
    transferId: null,
    createdBy: null,
    createdAt: new Date('2026-10-01T12:00:00Z'),
    updatedAt: new Date('2026-10-01T12:00:00Z'),
    ...overrides,
  };
}

/** O que o banco devolveria depois de gravar `data` (valores como Decimal). */
function stored(data: Record<string, any>) {
  const sent = Object.entries(data).filter(([, value]) => value !== undefined);
  const merged = { ...row(), ...Object.fromEntries(sent) };

  return {
    ...merged,
    amount: decimal(Number(merged.amount)),
    paidAmount:
      merged.paidAmount == null ? null : decimal(Number(merged.paidAmount)),
  };
}

function state(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payable-1',
    status: 'PENDING',
    accountId: null,
    categoryId: null,
    supplierId: null,
    supplierBankAccountId: null,
    employeeId: null,
    payrollType: null,
    competence: null,
    seriesId: null,
    seriesIndex: null,
    ...overrides,
  };
}

const active = (id: string, name: string) => ({ id, name, active: true });

describe('PayablesService', () => {
  let prisma: any;
  let createdRows: any[];
  let service: PayablesService;

  beforeEach(() => {
    createdRows = [];
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T15:00:00Z'));

    prisma = {
      financialEntry: {
        // Depois de gravar, a criação lê as contas pelos ids
        findMany: vi
          .fn()
          .mockImplementation(({ where }) =>
            Promise.resolve(where?.id?.in ? createdRows : []),
          ),
        findFirst: vi.fn().mockResolvedValue(state()),
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({
          _count: { _all: 0 },
          _sum: { amount: null, paidAmount: null },
        }),
        create: vi.fn().mockImplementation(({ data }) => {
          const entry = stored({
            ...data,
            id: `payable-${createdRows.length + 1}`,
          });

          createdRows.push(entry);

          return Promise.resolve({ id: entry.id });
        }),
        update: vi
          .fn()
          .mockImplementation(({ data }) => Promise.resolve(stored(data))),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      financialAccount: {
        findFirst: vi.fn().mockResolvedValue(active('acc-bank', 'Banco')),
      },
      financialCategory: {
        findFirst: vi.fn().mockResolvedValue({
          ...active('cat-rent', 'Aluguel e condomínio'),
          direction: 'OUT',
        }),
      },
      supplier: {
        findFirst: vi.fn().mockResolvedValue(active('supplier-1', 'Alfa')),
      },
      supplierBankAccount: {
        findFirst: vi.fn().mockResolvedValue({ id: 'bank-1' }),
      },
      employee: {
        findFirst: vi.fn().mockResolvedValue(active('employee-1', 'Ana')),
      },
      $transaction: vi.fn().mockImplementation((work) => work(prisma)),
    };

    service = new PayablesService(prisma, {
      ensureSetup: vi.fn().mockResolvedValue(undefined),
    } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const base = {
    description: 'Compra de mercadorias',
    supplierId: 'supplier-1',
    supplierBankAccountId: 'bank-1',
    categoryId: 'cat-rent',
  };

  describe('create', () => {
    it('creates a single payable open, with the supplier and the expected account', async () => {
      const [payable] = await service.create('org-1', 'user-1', {
        ...base,
        accountId: 'acc-bank',
        installments: [{ dueDate: '2026-11-05', amount: 1500 }],
      });

      const { data } = prisma.financialEntry.create.mock.calls[0][0];

      expect(data).toMatchObject({
        organizationId: 'org-1',
        origin: 'MANUAL',
        direction: 'OUT',
        status: 'PENDING',
        amount: 1500,
        dueDate: new Date('2026-11-05T00:00:00Z'),
        supplierId: 'supplier-1',
        supplierBankAccountId: 'bank-1',
        accountId: 'acc-bank',
        paidAmount: null,
        seriesId: null,
        createdById: 'user-1',
      });
      expect(payable).toMatchObject({ amount: 1500, series: null });
    });

    it('numbers the installments of a series in the order sent', async () => {
      await service.create('org-1', 'user-1', {
        ...base,
        seriesType: 'INSTALLMENTS',
        installments: [
          { dueDate: '2026-11-19', amount: 1000 },
          { dueDate: '2026-12-19', amount: 1000 },
          { dueDate: '2027-01-18', amount: 1000.01 },
        ],
      });

      const created = prisma.financialEntry.create.mock.calls.map(
        ([{ data }]: any) => data,
      );

      expect(new Set(created.map((data: any) => data.seriesId)).size).toBe(1);
      expect(created[0].seriesId).toEqual(expect.any(String));
      expect(
        created.map((data: any) => [
          data.seriesIndex,
          data.seriesSize,
          data.amount,
        ]),
      ).toEqual([
        [1, 3, 1000],
        [2, 3, 1000],
        [3, 3, 1000.01],
      ]);
      expect(created[0].seriesType).toBe('INSTALLMENTS');
    });

    it('registers the payment of a single payable already paid', async () => {
      await service.create('org-1', 'user-1', {
        ...base,
        paymentMethod: 'BANK_SLIP',
        installments: [{ dueDate: '2026-10-15', amount: 300 }],
        payment: {
          paymentDate: '2026-10-15',
          accountId: 'acc-bank',
          paidAmount: 305.5,
        },
      });

      expect(prisma.financialEntry.create.mock.calls[0][0].data).toMatchObject({
        status: 'PAID',
        paidAmount: 305.5,
        paymentDate: new Date('2026-10-15T00:00:00Z'),
        settlementDate: new Date('2026-10-15T00:00:00Z'),
        accountId: 'acc-bank',
        paymentMethod: 'BANK_SLIP',
      });
    });

    it('does not register the payment of a series nor a future payment', async () => {
      const payment = {
        paymentDate: '2026-10-15',
        accountId: 'acc-bank',
        paidAmount: 100,
      };

      await expect(
        service.create('org-1', 'user-1', {
          ...base,
          seriesType: 'RECURRING',
          installments: [
            { dueDate: '2026-11-05', amount: 100 },
            { dueDate: '2026-12-05', amount: 100 },
          ],
          payment,
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.create('org-1', 'user-1', {
          ...base,
          installments: [{ dueDate: '2026-11-05', amount: 100 }],
          payment: { ...payment, paymentDate: '2026-10-21' },
        }),
      ).rejects.toThrow('A data do pagamento não pode ser futura');
      expect(prisma.financialEntry.create).not.toHaveBeenCalled();
    });

    it('requires the payroll fields with an employee and never both payees', async () => {
      await expect(
        service.create('org-1', 'user-1', {
          description: 'Salário',
          employeeId: 'employee-1',
          installments: [{ dueDate: '2026-11-05', amount: 3000 }],
        }),
      ).rejects.toThrow(
        'Informe o tipo do pagamento e o mês de referência da folha',
      );

      await expect(
        service.create('org-1', 'user-1', {
          ...base,
          employeeId: 'employee-1',
          payrollType: 'SALARY',
          competence: '2026-10',
          installments: [{ dueDate: '2026-11-05', amount: 3000 }],
        }),
      ).rejects.toThrow('Escolha um fornecedor ou um funcionário, não os dois');
    });

    it('stores the payroll month as its first day', async () => {
      await service.create('org-1', 'user-1', {
        description: 'Adiantamento 10/2026',
        employeeId: 'employee-1',
        payrollType: 'ADVANCE',
        competence: '2026-10',
        installments: [{ dueDate: '2026-10-20', amount: 1200 }],
      });

      expect(prisma.financialEntry.create.mock.calls[0][0].data).toMatchObject({
        employeeId: 'employee-1',
        payrollType: 'ADVANCE',
        competence: new Date('2026-10-01T00:00:00Z'),
      });
    });

    it('rejects an inactive supplier, a revenue category and a bank account of another supplier', async () => {
      prisma.supplier.findFirst.mockResolvedValueOnce({
        id: 'supplier-1',
        name: 'Alfa',
        active: false,
      });

      await expect(
        service.create('org-1', 'user-1', {
          ...base,
          installments: [{ dueDate: '2026-11-05', amount: 100 }],
        }),
      ).rejects.toThrow(
        'O fornecedor Alfa está inativo: reative-o em Fornecedores para lançar contas dele',
      );

      prisma.financialCategory.findFirst.mockResolvedValueOnce({
        ...active('cat-sales', 'Vendas e serviços'),
        direction: 'IN',
      });
      prisma.supplierBankAccount.findFirst.mockResolvedValueOnce({
        id: 'bank-1',
      });

      await expect(
        service.create('org-1', 'user-1', {
          ...base,
          installments: [{ dueDate: '2026-11-05', amount: 100 }],
        }),
      ).rejects.toThrow('Escolha uma categoria de despesa');

      prisma.supplierBankAccount.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.create('org-1', 'user-1', {
          ...base,
          installments: [{ dueDate: '2026-11-05', amount: 100 }],
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('drops the bank account of the previous supplier when the supplier changes', async () => {
      prisma.financialEntry.findFirst.mockResolvedValue(
        state({ supplierId: 'supplier-1', supplierBankAccountId: 'bank-1' }),
      );

      await service.update('payable-1', 'org-1', { supplierId: 'supplier-2' });

      expect(prisma.financialEntry.update.mock.calls[0][0].data).toMatchObject({
        supplierId: 'supplier-2',
        supplierBankAccountId: null,
      });
    });

    it('keeps the inactive category the payable already had', async () => {
      prisma.financialEntry.findFirst.mockResolvedValue(
        state({ categoryId: 'cat-old' }),
      );
      prisma.financialCategory.findFirst.mockResolvedValue({
        id: 'cat-old',
        name: 'Antiga',
        direction: 'OUT',
        active: false,
      });

      await expect(
        service.update('payable-1', 'org-1', { amount: 2100 }),
      ).resolves.toMatchObject({ amount: 2100 });
    });

    it('keeps the account of a paid payable', async () => {
      prisma.financialEntry.findFirst.mockResolvedValue(
        state({ status: 'PAID', accountId: 'acc-bank' }),
      );

      await expect(
        service.update('payable-1', 'org-1', { accountId: null }),
      ).rejects.toThrow(
        'A conta paga precisa da conta de onde saiu o dinheiro',
      );
    });
  });

  describe('pay', () => {
    it('settles an open payable from the account, on the payment day', async () => {
      prisma.financialEntry.findFirst
        .mockResolvedValueOnce(state())
        .mockResolvedValueOnce(row({ status: 'PAID' }));

      await service.pay('payable-1', 'org-1', {
        paymentDate: '2026-10-20',
        accountId: 'acc-bank',
        paidAmount: 2040,
        paymentMethod: 'PIX',
      });

      expect(prisma.financialEntry.updateMany).toHaveBeenCalledWith({
        where: { id: 'payable-1', status: 'PENDING' },
        data: {
          status: 'PAID',
          paidAmount: 2040,
          paymentDate: new Date('2026-10-20T00:00:00Z'),
          settlementDate: new Date('2026-10-20T00:00:00Z'),
          accountId: 'acc-bank',
          paymentMethod: 'PIX',
        },
      });
    });

    it('does not pay twice', async () => {
      prisma.financialEntry.findFirst.mockResolvedValue(
        state({ status: 'PAID' }),
      );

      await expect(
        service.pay('payable-1', 'org-1', {
          paymentDate: '2026-10-20',
          accountId: 'acc-bank',
          paidAmount: 2000,
        }),
      ).rejects.toThrow(ConflictException);

      prisma.financialEntry.findFirst.mockResolvedValue(state());
      prisma.financialEntry.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.pay('payable-1', 'org-1', {
          paymentDate: '2026-10-20',
          accountId: 'acc-bank',
          paidAmount: 2000,
        }),
      ).rejects.toThrow('Esta conta já está paga.');
    });

    it('does not pay from an inactive account', async () => {
      prisma.financialAccount.findFirst.mockResolvedValue({
        id: 'acc-old',
        name: 'Banco antigo',
        active: false,
      });

      await expect(
        service.pay('payable-1', 'org-1', {
          paymentDate: '2026-10-20',
          accountId: 'acc-old',
          paidAmount: 2000,
        }),
      ).rejects.toThrow(
        'A conta Banco antigo está inativa: reative-a no Caixa para usá-la',
      );
    });
  });

  it('reopens a paid payable, taking the money back to the account', async () => {
    prisma.financialEntry.findFirst
      .mockResolvedValueOnce(state({ status: 'PAID' }))
      .mockResolvedValueOnce(row());

    await service.reopen('payable-1', 'org-1');

    expect(prisma.financialEntry.updateMany).toHaveBeenCalledWith({
      where: { id: 'payable-1', status: 'PAID' },
      data: {
        status: 'PENDING',
        paidAmount: null,
        paymentDate: null,
        settlementDate: null,
      },
    });
  });

  describe('remove', () => {
    it('deletes this payable and the next open ones of the series', async () => {
      prisma.financialEntry.findFirst.mockResolvedValue(
        state({ seriesId: 'series-1', seriesIndex: 3 }),
      );
      prisma.financialEntry.findMany.mockResolvedValue([
        { id: 'payable-4' },
        { id: 'payable-5' },
      ]);
      prisma.financialEntry.deleteMany.mockResolvedValue({ count: 3 });

      await expect(
        service.remove('payable-1', 'org-1', 'FOLLOWING'),
      ).resolves.toEqual({ count: 3 });

      expect(prisma.financialEntry.findMany.mock.calls[0][0].where).toEqual({
        organizationId: 'org-1',
        seriesId: 'series-1',
        seriesIndex: { gt: 3 },
        status: 'PENDING',
      });
      expect(prisma.financialEntry.deleteMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          id: { in: ['payable-1', 'payable-4', 'payable-5'] },
        },
      });
    });

    it('deletes only this payable by default', async () => {
      await service.remove('payable-1', 'org-1');

      expect(prisma.financialEntry.findMany).not.toHaveBeenCalled();
      expect(
        prisma.financialEntry.deleteMany.mock.calls[0][0].where.id,
      ).toEqual({ in: ['payable-1'] });
    });
  });

  describe('findAll', () => {
    it('lists the overdue ones, the most urgent first, with the overdue flag', async () => {
      prisma.financialEntry.findMany.mockResolvedValue([row()]);
      prisma.financialEntry.count.mockResolvedValue(1);

      const result = await service.findAll('org-1', {
        page: 1,
        limit: 10,
        status: 'OVERDUE',
      });

      const query = prisma.financialEntry.findMany.mock.calls[0][0];

      expect(query.where).toMatchObject({
        organizationId: 'org-1',
        origin: 'MANUAL',
        direction: 'OUT',
        AND: [
          {
            status: 'PENDING',
            dueDate: { lt: new Date('2026-10-20T00:00:00Z') },
          },
        ],
      });
      expect(query.orderBy[0]).toEqual({ dueDate: 'asc' });
      expect(result.data[0]).toMatchObject({
        dueDate: '2026-10-10',
        isOverdue: true,
      });
    });

    it('filters the period by the payment date when asked', async () => {
      await service.findAll('org-1', {
        page: 1,
        limit: 10,
        status: 'PAID',
        dateField: 'paymentDate',
        from: '2026-10-01',
        to: '2026-10-31',
      });

      const query = prisma.financialEntry.findMany.mock.calls[0][0];

      expect(query.where.AND).toContainEqual({
        paymentDate: {
          gte: new Date('2026-10-01T00:00:00Z'),
          lte: new Date('2026-10-31T00:00:00Z'),
        },
      });
      expect(query.orderBy[0]).toEqual({ paymentDate: 'desc' });
    });
  });

  it('totals the overdue, the open and the paid this month', async () => {
    prisma.financialEntry.aggregate
      .mockResolvedValueOnce({
        _count: { _all: 2 },
        _sum: { amount: decimal(350.5) },
      })
      .mockResolvedValueOnce({
        _count: { _all: 4 },
        _sum: { amount: decimal(5000) },
      })
      .mockResolvedValueOnce({
        _count: { _all: 1 },
        _sum: { paidAmount: decimal(2040) },
      });

    await expect(service.totals('org-1')).resolves.toEqual({
      overdue: { count: 2, total: 350.5 },
      open: { count: 4, total: 5000 },
      paidThisMonth: { count: 1, total: 2040 },
    });
    expect(
      prisma.financialEntry.aggregate.mock.calls[2][0].where.paymentDate,
    ).toEqual({
      gte: new Date('2026-10-01T00:00:00Z'),
      lte: new Date('2026-10-31T00:00:00Z'),
    });
  });
});
