import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ReceiptsService } from './receipts.service.js';

vi.mock('../../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

const decimal = (value: number) => new Prisma.Decimal(value);

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'receipt-1',
    direction: 'IN',
    origin: 'MANUAL',
    status: 'PAID',
    description: 'Venda no balcão',
    amount: decimal(150),
    dueDate: null,
    paidAmount: decimal(150),
    feeAmount: decimal(0),
    paymentDate: new Date('2026-10-18T00:00:00Z'),
    settlementDate: new Date('2026-10-18T00:00:00Z'),
    paymentMethod: 'CASH',
    account: { id: 'acc-cash', name: 'Dinheiro', type: 'CASH' },
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
    createdAt: new Date('2026-10-18T12:00:00Z'),
    updatedAt: new Date('2026-10-18T12:00:00Z'),
    ...overrides,
  };
}

describe('ReceiptsService', () => {
  let prisma: any;
  let service: ReceiptsService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T15:00:00Z'));

    prisma = {
      financialEntry: {
        findMany: vi.fn().mockResolvedValue([row()]),
        findFirst: vi.fn().mockResolvedValue({
          id: 'receipt-1',
          origin: 'MANUAL',
          direction: 'IN',
          accountId: 'acc-cash',
          categoryId: null,
          clientId: null,
        }),
        count: vi.fn().mockResolvedValue(1),
        groupBy: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue(row()),
        update: vi.fn().mockResolvedValue(row()),
        delete: vi.fn().mockResolvedValue(row()),
      },
      financialAccount: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'acc-cash',
          name: 'Dinheiro',
          active: true,
        }),
      },
      financialCategory: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'cat-sales',
          name: 'Vendas e serviços',
          direction: 'IN',
          active: true,
        }),
      },
      client: { findFirst: vi.fn().mockResolvedValue({ id: 'client-1' }) },
    };

    service = new ReceiptsService(prisma, {
      ensureSetup: vi.fn().mockResolvedValue(undefined),
    } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists the receipts of the invoices and the manual ones, in the period', async () => {
    const result = await service.findAll('org-1', {
      page: 1,
      limit: 10,
      from: '2026-10-01',
      to: '2026-10-31',
      q: 'balcão',
    });

    const { where, orderBy } = prisma.financialEntry.findMany.mock.calls[0][0];

    expect(where.organizationId).toBe('org-1');
    expect(where.AND).toEqual([
      {
        OR: [{ origin: 'INVOICE' }, { origin: 'MANUAL', direction: 'IN' }],
      },
      {
        paymentDate: {
          gte: new Date('2026-10-01T00:00:00Z'),
          lte: new Date('2026-10-31T00:00:00Z'),
        },
      },
      {
        OR: [
          { description: { contains: 'balcão', mode: 'insensitive' } },
          { documentNumber: { contains: 'balcão', mode: 'insensitive' } },
          { client: { name: { contains: 'balcão', mode: 'insensitive' } } },
        ],
      },
    ]);
    expect(orderBy[0]).toEqual({ paymentDate: 'desc' });
    expect(result.data[0]).toMatchObject({
      amount: 150,
      netAmount: 150,
      paymentDate: '2026-10-18',
    });
  });

  it('totals the gross received, the fees, the refunds and the net', async () => {
    prisma.financialEntry.groupBy.mockResolvedValue([
      {
        direction: 'IN',
        _count: { _all: 3 },
        _sum: { paidAmount: decimal(300), feeAmount: decimal(5.97) },
      },
      {
        direction: 'OUT',
        _count: { _all: 1 },
        _sum: { paidAmount: decimal(50), feeAmount: decimal(0) },
      },
    ]);

    await expect(
      service.totals('org-1', { page: 1, limit: 10 }),
    ).resolves.toEqual({
      count: 4,
      received: 300,
      fees: 5.97,
      refunded: 50,
      net: 244.03,
    });
    expect(prisma.financialEntry.groupBy.mock.calls[0][0].where.AND[1]).toEqual(
      { status: 'PAID' },
    );
  });

  it('creates a manual receipt already received, on the day, in the account', async () => {
    await service.create('org-1', 'user-1', {
      description: 'Venda no balcão',
      amount: 150,
      paymentDate: '2026-10-18',
      accountId: 'acc-cash',
      categoryId: 'cat-sales',
      clientId: 'client-1',
      paymentMethod: 'CASH',
    });

    expect(prisma.financialEntry.create.mock.calls[0][0].data).toEqual({
      organizationId: 'org-1',
      direction: 'IN',
      origin: 'MANUAL',
      status: 'PAID',
      description: 'Venda no balcão',
      amount: 150,
      paidAmount: 150,
      paymentDate: new Date('2026-10-18T00:00:00Z'),
      settlementDate: new Date('2026-10-18T00:00:00Z'),
      paymentMethod: 'CASH',
      accountId: 'acc-cash',
      categoryId: 'cat-sales',
      clientId: 'client-1',
      documentNumber: null,
      notes: null,
      createdById: 'user-1',
    });
  });

  it('rejects a future receipt and an expense category', async () => {
    await expect(
      service.create('org-1', 'user-1', {
        description: 'Venda',
        amount: 10,
        paymentDate: '2026-10-21',
        accountId: 'acc-cash',
      }),
    ).rejects.toThrow('A data do recebimento não pode ser futura');

    prisma.financialCategory.findFirst.mockResolvedValue({
      id: 'cat-rent',
      name: 'Aluguel',
      direction: 'OUT',
      active: true,
    });

    await expect(
      service.create('org-1', 'user-1', {
        description: 'Venda',
        amount: 10,
        paymentDate: '2026-10-20',
        accountId: 'acc-cash',
        categoryId: 'cat-rent',
      }),
    ).rejects.toThrow('Escolha uma categoria de receita');
  });

  describe('receipts of the invoices', () => {
    beforeEach(() => {
      prisma.financialEntry.findFirst.mockResolvedValue({
        id: 'receipt-1',
        origin: 'INVOICE',
        direction: 'IN',
        accountId: 'acc-provider',
        categoryId: null,
        clientId: 'client-1',
      });
    });

    it('only change the account, the category and the notes', async () => {
      await service.update('receipt-1', 'org-1', {
        accountId: 'acc-cash',
        categoryId: 'cat-sales',
        notes: 'Conferido no extrato',
      });

      expect(prisma.financialEntry.update.mock.calls[0][0].data).toMatchObject({
        accountId: 'acc-cash',
        categoryId: 'cat-sales',
        notes: 'Conferido no extrato',
        amount: undefined,
        paymentDate: undefined,
      });

      await expect(
        service.update('receipt-1', 'org-1', { amount: 99 }),
      ).rejects.toThrow(
        'Os recebimentos das faturas seguem as movimentações da fatura: aqui só mudam a conta, a categoria e a observação',
      );
    });

    it('are not deleted', async () => {
      await expect(service.remove('receipt-1', 'org-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.financialEntry.delete).not.toHaveBeenCalled();
    });
  });

  it('deletes a manual receipt of the organization', async () => {
    await service.remove('receipt-1', 'org-1');

    expect(prisma.financialEntry.delete.mock.calls[0][0].where).toEqual({
      id: 'receipt-1',
    });

    prisma.financialEntry.findFirst.mockResolvedValue(null);

    await expect(service.remove('receipt-1', 'org-2')).rejects.toThrow(
      NotFoundException,
    );
  });
});
