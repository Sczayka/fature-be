import { Prisma } from '@prisma/client';
import { DashboardService, receiptsBuckets } from './dashboard.service.js';

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

const decimal = (value: number) => new Prisma.Decimal(value);
const day = (date: string) => new Date(`${date}T00:00:00Z`);

/** Grupo do groupBy dos recebimentos: pagamento (IN) ou devolução (OUT). */
function receiptGroup(
  direction: 'IN' | 'OUT',
  paidAmount: number,
  feeAmount: number,
  extra: Record<string, unknown> = {},
  count = 1,
) {
  return {
    direction,
    _count: { _all: count },
    _sum: { paidAmount: decimal(paidAmount), feeAmount: decimal(feeAmount) },
    ...extra,
  };
}

describe('receiptsBuckets', () => {
  it('splits the last 30 days day by day, ending today', () => {
    const { granularity, starts } = receiptsBuckets('30d', '2026-10-24');

    expect(granularity).toBe('day');
    expect(starts).toHaveLength(30);
    expect(starts[0]).toBe('2026-09-25');
    expect(starts[29]).toBe('2026-10-24');
  });

  it('splits the last months by their first day, across the turn of the year', () => {
    expect(receiptsBuckets('6m', '2027-02-10')).toEqual({
      granularity: 'month',
      starts: [
        '2026-09-01',
        '2026-10-01',
        '2026-11-01',
        '2026-12-01',
        '2027-01-01',
        '2027-02-01',
      ],
    });
    expect(receiptsBuckets('12m', '2026-10-24').starts[0]).toBe('2025-11-01');
  });
});

describe('DashboardService', () => {
  let prisma: any;
  let service: DashboardService;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 12:00 em São Paulo
    vi.setSystemTime(new Date('2026-10-24T15:00:00Z'));

    prisma = {
      invoice: {
        aggregate: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
      financialEntry: {
        groupBy: vi.fn().mockResolvedValue([]),
        findMany: vi.fn().mockResolvedValue([]),
      },
      invoiceDraft: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
    };

    service = new DashboardService(prisma);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('summary', () => {
    beforeEach(() => {
      prisma.invoice.aggregate
        // A receber
        .mockResolvedValueOnce({
          _count: { _all: 3 },
          _sum: { totalValue: 1500.5 },
        })
        // Vencido
        .mockResolvedValueOnce({
          _count: { _all: 2 },
          _sum: { totalValue: 250 },
        })
        // Já venceu: pago ou não
        .mockResolvedValueOnce({ _sum: { totalValue: 1000 } })
        // Emitidas no mês
        .mockResolvedValueOnce({
          _count: { _all: 4 },
          _avg: { totalValue: 333.333 },
        });
    });

    it('computes the indicators with the displayed status rules', async () => {
      prisma.financialEntry.groupBy.mockResolvedValue([
        receiptGroup('IN', 900, 12.5, {}, 3),
        receiptGroup('OUT', 50, 0),
      ]);

      const summary = await service.summary('org-1');

      expect(summary).toMatchObject({
        today: '2026-10-24',
        receivable: { count: 3, total: 1500.5 },
        // 250 dos 1.000 que já venceram
        overdue: { count: 2, total: 250, rate: 0.25 },
        receivedThisMonth: {
          count: 3,
          gross: 900,
          fees: 12.5,
          refunded: 50,
          net: 837.5,
        },
        averageTicket: { count: 4, average: 333.33 },
      });

      const [receivable, overdue, due, issued] =
        prisma.invoice.aggregate.mock.calls.map(([args]: any[]) => args);
      const startOfToday = day('2026-10-24');

      expect(receivable.where.AND[0].OR).toEqual([
        {
          status: { in: ['PENDING', 'OVERDUE'] },
          dueDate: { gte: startOfToday },
        },
        { status: 'AWAITING_CONFIRMATION' },
      ]);
      // A marcada como vencida pelo provedor antes do vencimento não entra
      expect(overdue.where).toEqual({
        organizationId: 'org-1',
        AND: [
          {
            status: { in: ['PENDING', 'OVERDUE'] },
            dueDate: { lt: startOfToday },
          },
        ],
      });
      expect(due.where).toEqual({
        organizationId: 'org-1',
        status: { not: 'CANCELLED' },
        dueDate: { lt: startOfToday },
      });
      // O mês começa à meia-noite em São Paulo
      expect(issued.where.createdAt).toEqual({
        gte: new Date('2026-10-01T03:00:00Z'),
      });
      expect(prisma.financialEntry.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['direction'],
          where: {
            organizationId: 'org-1',
            origin: 'INVOICE',
            status: 'PAID',
            paymentDate: { gte: day('2026-10-01'), lte: day('2026-10-31') },
          },
        }),
      );
    });

    it('leaves the default rate empty when nothing came due yet', async () => {
      prisma.invoice.aggregate.mockReset();
      prisma.invoice.aggregate.mockResolvedValue({
        _count: { _all: 0 },
        _sum: { totalValue: null },
        _avg: { totalValue: null },
      });

      const summary = await service.summary('org-1');

      expect(summary.overdue).toEqual({ count: 0, total: 0, rate: null });
      expect(summary.averageTicket).toEqual({ count: 0, average: 0 });
      expect(summary.receivedThisMonth).toEqual({
        count: 0,
        gross: 0,
        fees: 0,
        refunded: 0,
        net: 0,
      });
    });

    it('lists the next due, the latest overdue and the latest payments', async () => {
      const invoice = (id: string, dueDate: string) => ({
        id,
        totalValue: 100.1,
        dueDate: day(dueDate),
        client: { id: 'client-1', name: 'Maria' },
      });

      prisma.invoice.findMany
        .mockResolvedValueOnce([invoice('inv-next', '2026-10-25')])
        .mockResolvedValueOnce([invoice('inv-late', '2026-10-20')]);
      prisma.financialEntry.findMany.mockResolvedValue([
        {
          id: 'entry-1',
          invoiceId: 'inv-paid',
          paidAmount: decimal(300),
          feeAmount: decimal(1.99),
          paymentDate: day('2026-10-23'),
          paymentMethod: 'PIX',
          client: { id: 'client-2', name: 'João' },
        },
      ]);

      const summary = await service.summary('org-1');

      expect(summary.upcomingInvoices).toEqual([
        {
          id: 'inv-next',
          client: { id: 'client-1', name: 'Maria' },
          totalValue: 100.1,
          dueDate: '2026-10-25',
        },
      ]);
      expect(summary.overdueInvoices[0]).toMatchObject({
        id: 'inv-late',
        dueDate: '2026-10-20',
      });
      expect(summary.latestPayments).toEqual([
        {
          id: 'entry-1',
          invoiceId: 'inv-paid',
          client: { id: 'client-2', name: 'João' },
          method: 'PIX',
          amount: 300,
          fee: 1.99,
          paymentDate: '2026-10-23',
        },
      ]);

      const [upcomingQuery, overdueQuery] =
        prisma.invoice.findMany.mock.calls.map(([args]: any[]) => args);

      // A vencer: a mais próxima primeiro; vencidas: a que venceu por último primeiro
      expect(upcomingQuery).toMatchObject({
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
        take: 5,
      });
      expect(overdueQuery).toMatchObject({
        orderBy: [{ dueDate: 'desc' }, { createdAt: 'desc' }],
        take: 5,
      });
      expect(prisma.financialEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: 'org-1',
            origin: 'INVOICE',
            status: 'PAID',
            direction: 'IN',
            paymentMethod: { not: null },
            paymentDate: { not: null },
          },
        }),
      );
    });

    it('sums the open quotes with the item discounts and the conversion rate', async () => {
      prisma.invoiceDraft.findMany.mockResolvedValue([
        {
          items: [
            {
              item: { id: 'item-1', name: 'Site', price: 100 },
              quantity: 2,
              total: 200,
            },
          ],
          billing: null,
          discount: {
            items: [{ id: 'item-1', type: 'FIXED', value: 20 }],
            methods: [],
          },
          interestAndFine: null,
        },
        // Salvo pela metade, sem itens
        { items: [], billing: null, discount: null, interestAndFine: null },
      ]);
      prisma.invoiceDraft.count
        .mockResolvedValueOnce(8)
        .mockResolvedValueOnce(2);

      const summary = await service.summary('org-1');

      expect(summary.quotes).toEqual({
        open: { count: 2, total: 180 },
        conversion: { days: 90, created: 8, converted: 2, rate: 0.25 },
      });
      expect(prisma.invoiceDraft.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: 'org-1', convertedAt: null },
        }),
      );

      const [created, converted] = prisma.invoiceDraft.count.mock.calls.map(
        ([args]: any[]) => args.where,
      );
      // Os últimos 90 dias, hoje incluído: desde 27/07 à meia-noite em São Paulo
      const since = { gte: new Date('2026-07-27T03:00:00Z') };

      expect(created).toEqual({ organizationId: 'org-1', createdAt: since });
      expect(converted).toEqual({
        organizationId: 'org-1',
        createdAt: since,
        convertedAt: { not: null },
      });
    });
  });

  describe('receipts', () => {
    it('groups the invoice receipts by month and payment method', async () => {
      prisma.financialEntry.groupBy.mockResolvedValue([
        receiptGroup('IN', 100, 2, {
          paymentDate: day('2026-10-02'),
          paymentMethod: 'BANK_SLIP',
        }),
        receiptGroup('IN', 300, 3, {
          paymentDate: day('2026-10-20'),
          paymentMethod: 'PIX',
        }),
        receiptGroup(
          'IN',
          50,
          1,
          { paymentDate: day('2026-09-15'), paymentMethod: 'PIX' },
          2,
        ),
        // Devolução de um excedente
        receiptGroup('OUT', 20, 0, {
          paymentDate: day('2026-10-21'),
          paymentMethod: 'PIX',
        }),
      ]);

      const receipts = await service.receipts('org-1', '6m');

      expect(prisma.financialEntry.groupBy).toHaveBeenCalledWith({
        by: ['paymentDate', 'paymentMethod', 'direction'],
        where: {
          organizationId: 'org-1',
          origin: 'INVOICE',
          status: 'PAID',
          paymentMethod: { not: null },
          paymentDate: { gte: day('2026-05-01'), lte: day('2026-10-24') },
        },
        _count: { _all: true },
        _sum: { paidAmount: true, feeAmount: true },
      });
      expect(receipts).toMatchObject({
        period: '6m',
        granularity: 'month',
        from: '2026-05-01',
        to: '2026-10-24',
      });
      expect(receipts.series.map((bucket) => bucket.start)).toEqual([
        '2026-05-01',
        '2026-06-01',
        '2026-07-01',
        '2026-08-01',
        '2026-09-01',
        '2026-10-01',
      ]);
      // Só as formas que receberam algo no período, zeradas nos meses sem nada
      expect(receipts.series[0]).toEqual({
        start: '2026-05-01',
        count: 0,
        gross: 0,
        fees: 0,
        refunded: 0,
        net: 0,
        byMethod: [
          { method: 'BANK_SLIP', gross: 0 },
          { method: 'PIX', gross: 0 },
        ],
      });
      expect(receipts.series[5]).toEqual({
        start: '2026-10-01',
        count: 2,
        gross: 400,
        fees: 5,
        refunded: 20,
        net: 375,
        byMethod: [
          { method: 'BANK_SLIP', gross: 100 },
          { method: 'PIX', gross: 300 },
        ],
      });
      // Pelo bruto, o maior primeiro
      expect(receipts.methods).toEqual([
        { method: 'PIX', count: 3, gross: 350, fees: 4 },
        { method: 'BANK_SLIP', count: 1, gross: 100, fees: 2 },
      ]);
      expect(receipts.totals).toEqual({
        count: 4,
        gross: 450,
        fees: 6,
        refunded: 20,
        net: 424,
      });
    });

    it('groups the last 30 days day by day', async () => {
      prisma.financialEntry.groupBy.mockResolvedValue([
        receiptGroup('IN', 80, 0, {
          paymentDate: day('2026-10-24'),
          paymentMethod: 'BANK_TRANSFER',
        }),
      ]);

      const receipts = await service.receipts('org-1', '30d');

      expect(receipts.granularity).toBe('day');
      expect(receipts.series).toHaveLength(30);
      expect(receipts.series[29]).toMatchObject({
        start: '2026-10-24',
        gross: 80,
        byMethod: [{ method: 'BANK_TRANSFER', gross: 80 }],
      });
      expect(receipts.series[0].byMethod).toEqual([
        { method: 'BANK_TRANSFER', gross: 0 },
      ]);
    });
  });
});
