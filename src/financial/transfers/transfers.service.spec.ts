import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TransfersService } from './transfers.service.js';

vi.mock('../../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

describe('TransfersService', () => {
  let prisma: any;
  let stored: any[];
  let service: TransfersService;

  beforeEach(() => {
    stored = [];
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T15:00:00Z'));

    prisma = {
      financialAccount: {
        findFirst: vi.fn().mockImplementation(({ where }) =>
          Promise.resolve({
            id: where.id,
            name: where.id === 'acc-provider' ? 'Conta Fature' : 'Banco',
            active: true,
          }),
        ),
      },
      financialEntry: {
        create: vi.fn().mockImplementation(({ data }) => {
          const entry = {
            ...data,
            id: `entry-${data.direction}`,
            amount: new Prisma.Decimal(data.amount),
            paidAmount: new Prisma.Decimal(data.paidAmount),
            feeAmount: new Prisma.Decimal(0),
            dueDate: null,
            competence: null,
            seriesId: null,
          };

          stored.push(entry);

          return Promise.resolve({ id: entry.id });
        }),
        findMany: vi.fn().mockImplementation(() => Promise.resolve(stored)),
        deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      $transaction: vi.fn().mockImplementation((work) => work(prisma)),
    };
    service = new TransfersService(prisma);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('takes the money out of one account and puts it in the other, with the same transfer id', async () => {
    const legs = await service.create('org-1', 'user-1', {
      fromAccountId: 'acc-provider',
      toAccountId: 'acc-bank',
      amount: 1200,
      date: '2026-10-20',
    });

    const [out, into] = prisma.financialEntry.create.mock.calls.map(
      ([{ data }]: any) => data,
    );

    expect(out).toMatchObject({
      direction: 'OUT',
      origin: 'TRANSFER',
      status: 'PAID',
      accountId: 'acc-provider',
      description: 'Transferência para Banco',
      settlementDate: new Date('2026-10-20T00:00:00Z'),
    });
    expect(into).toMatchObject({
      direction: 'IN',
      accountId: 'acc-bank',
      description: 'Transferência de Conta Fature',
    });
    expect(out.transferId).toEqual(expect.any(String));
    expect(into.transferId).toBe(out.transferId);
    expect(prisma.financialEntry.findMany.mock.calls[0][0].where).toEqual({
      transferId: out.transferId,
    });
    expect(legs.map((leg) => [leg.direction, leg.amount])).toEqual([
      ['OUT', 1200],
      ['IN', 1200],
    ]);
  });

  it('rejects the same account on both sides and a future date', async () => {
    await expect(
      service.create('org-1', 'user-1', {
        fromAccountId: 'acc-bank',
        toAccountId: 'acc-bank',
        amount: 10,
        date: '2026-10-20',
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.create('org-1', 'user-1', {
        fromAccountId: 'acc-provider',
        toAccountId: 'acc-bank',
        amount: 10,
        date: '2026-10-21',
      }),
    ).rejects.toThrow('A data da transferência não pode ser futura');
    expect(prisma.financialEntry.create).not.toHaveBeenCalled();
  });

  it('deletes both sides of the transfer', async () => {
    await expect(service.remove('trf-1', 'org-1')).resolves.toEqual({
      count: 2,
    });
    expect(prisma.financialEntry.deleteMany).toHaveBeenCalledWith({
      where: {
        transferId: 'trf-1',
        organizationId: 'org-1',
        origin: 'TRANSFER',
      },
    });

    prisma.financialEntry.deleteMany.mockResolvedValue({ count: 0 });

    await expect(service.remove('trf-1', 'org-2')).rejects.toThrow(
      NotFoundException,
    );
  });
});
