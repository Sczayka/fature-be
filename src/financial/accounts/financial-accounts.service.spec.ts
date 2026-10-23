import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FinancialAccountsService } from './financial-accounts.service.js';

// PrismaService abre o pool do banco ao ser importado; os testes usam mocks
vi.mock('../../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

const decimal = (value: number) => new Prisma.Decimal(value);

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: 'acc-bank',
    name: 'Conta bancária',
    type: 'BANK',
    openingBalance: decimal(1000),
    openingDate: new Date('2026-10-01T00:00:00Z'),
    isMain: true,
    active: true,
    notes: null,
    paymentGatewayAccountId: null,
    createdAt: new Date('2026-10-01T12:00:00Z'),
    updatedAt: new Date('2026-10-01T12:00:00Z'),
    ...overrides,
  };
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    direction: 'IN',
    origin: 'MANUAL',
    status: 'PAID',
    description: 'Venda no balcão',
    amount: decimal(100),
    dueDate: null,
    paidAmount: decimal(100),
    feeAmount: decimal(0),
    paymentDate: new Date('2026-10-10T00:00:00Z'),
    settlementDate: new Date('2026-10-10T00:00:00Z'),
    paymentMethod: 'CASH',
    account: { id: 'acc-bank', name: 'Conta bancária', type: 'BANK' },
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
    createdAt: new Date('2026-10-10T12:00:00Z'),
    updatedAt: new Date('2026-10-10T12:00:00Z'),
    ...overrides,
  };
}

const sums = (
  direction: string,
  paid: number,
  fee = 0,
  accountId = 'acc-bank',
) => ({
  accountId,
  direction,
  _sum: { paidAmount: decimal(paid), feeAmount: decimal(fee) },
});

describe('FinancialAccountsService', () => {
  let prisma: any;
  let setup: any;
  let provider: any;
  let service: FinancialAccountsService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T15:00:00Z'));

    prisma = {
      financialAccount: {
        findMany: vi.fn().mockResolvedValue([account()]),
        findFirst: vi.fn().mockResolvedValue(account()),
        create: vi.fn().mockResolvedValue({ id: 'acc-new' }),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        delete: vi.fn().mockResolvedValue({}),
      },
      financialEntry: {
        groupBy: vi.fn().mockResolvedValue([]),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      paymentGatewayAccount: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'gateway-1',
          provider: 'ASAAS',
          accountId: 'sub_1',
          metadata: {},
          status: 'ACTIVE',
        }),
      },
      $transaction: vi.fn().mockImplementation((work) => work(prisma)),
    };
    setup = { ensureSetup: vi.fn().mockResolvedValue(undefined) };
    provider = { getBalance: vi.fn().mockResolvedValue(512.3) };
    service = new FinancialAccountsService(prisma, setup, {
      get: vi.fn().mockReturnValue(provider),
    } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('findAll', () => {
    it('adds the paid entries since the opening day to the opening balance', async () => {
      prisma.financialEntry.groupBy
        .mockResolvedValueOnce([sums('IN', 300, 3), sums('OUT', 120)])
        .mockResolvedValueOnce([sums('IN', 99, 4.99)]);

      const [result] = await service.findAll('org-1', {});

      expect(setup.ensureSetup).toHaveBeenCalledWith('org-1');
      expect(result).toMatchObject({
        id: 'acc-bank',
        openingBalance: 1000,
        openingDate: '2026-10-01',
        isProviderAccount: false,
        balance: 1177,
        pendingCredits: 94.01,
      });
      expect(result).not.toHaveProperty('paymentGatewayAccountId');

      const [settled, upcoming] = prisma.financialEntry.groupBy.mock.calls;

      expect(settled[0].where).toEqual({
        status: 'PAID',
        OR: [
          {
            accountId: 'acc-bank',
            settlementDate: {
              gte: new Date('2026-10-01T00:00:00Z'),
              lte: new Date('2026-10-20T00:00:00Z'),
            },
          },
        ],
      });
      expect(upcoming[0].where.settlementDate).toEqual({
        gt: new Date('2026-10-20T00:00:00Z'),
      });
    });
  });

  describe('findOne', () => {
    it('shows the balance informed by the provider in its account', async () => {
      prisma.financialAccount.findFirst.mockResolvedValue(
        account({ paymentGatewayAccountId: 'gateway-1', isMain: false }),
      );

      await expect(service.findOne('acc-bank', 'org-1')).resolves.toMatchObject(
        { isProviderAccount: true, providerBalance: 512.3 },
      );
    });

    it('has no provider balance when the provider fails', async () => {
      const warnLog = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      prisma.financialAccount.findFirst.mockResolvedValue(
        account({ paymentGatewayAccountId: 'gateway-1', isMain: false }),
      );
      provider.getBalance.mockRejectedValue(new Error('timeout'));

      await expect(service.findOne('acc-bank', 'org-1')).resolves.toMatchObject(
        { providerBalance: null },
      );
      expect(warnLog).toHaveBeenCalled();
    });

    it('does not ask the provider while its account is not active', async () => {
      prisma.financialAccount.findFirst.mockResolvedValue(
        account({ paymentGatewayAccountId: 'gateway-1', isMain: false }),
      );
      prisma.paymentGatewayAccount.findUnique.mockResolvedValue({
        id: 'gateway-1',
        provider: 'ASAAS',
        accountId: '',
        metadata: null,
        status: 'AWAITING_COMPANY_INFO',
      });

      await expect(service.findOne('acc-bank', 'org-1')).resolves.toMatchObject(
        { providerBalance: null },
      );
      expect(provider.getBalance).not.toHaveBeenCalled();
    });

    it('is not found in another organization', async () => {
      prisma.financialAccount.findFirst.mockResolvedValue(null);

      await expect(service.findOne('acc-bank', 'org-2')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('unmarks the previous main account when the new one is the main', async () => {
      prisma.financialAccount.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValue(account({ id: 'acc-new' }));

      await service.create('org-1', {
        name: 'Banco Inter',
        type: 'BANK',
        openingBalance: 250,
        openingDate: '2026-10-15',
        isMain: true,
      });

      expect(prisma.financialAccount.updateMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', isMain: true },
        data: { isMain: false },
      });
      expect(prisma.financialAccount.create.mock.calls[0][0].data).toEqual({
        organizationId: 'org-1',
        name: 'Banco Inter',
        type: 'BANK',
        openingBalance: 250,
        openingDate: new Date('2026-10-15T00:00:00Z'),
        isMain: true,
        active: true,
        notes: null,
      });
    });

    it('rejects a name already in use and a future opening day', async () => {
      await expect(
        service.create('org-1', { name: 'conta bancária', type: 'BANK' }),
      ).rejects.toThrow(
        new ConflictException('Já existe uma conta com este nome.'),
      );

      prisma.financialAccount.findFirst.mockResolvedValue(null);

      await expect(
        service.create('org-1', {
          name: 'Cofre',
          type: 'CASH',
          openingDate: '2026-10-21',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('does not unmark or inactivate the main account by itself', async () => {
      prisma.financialAccount.findFirst
        .mockResolvedValueOnce(account())
        .mockResolvedValueOnce(account());

      await expect(
        service.update('acc-bank', 'org-1', { isMain: false }),
      ).rejects.toThrow(
        'Para trocar a conta principal, marque outra conta como principal',
      );
      await expect(
        service.update('acc-bank', 'org-1', { active: false }),
      ).rejects.toThrow(
        'A conta principal não pode ser inativada: marque outra conta como principal antes',
      );
      expect(prisma.financialAccount.update).not.toHaveBeenCalled();
    });

    it('keeps the provider account as a provider account', async () => {
      prisma.financialAccount.findFirst.mockResolvedValue(
        account({
          type: 'PAYMENT_PROVIDER',
          paymentGatewayAccountId: 'gateway-1',
          isMain: false,
        }),
      );

      await expect(
        service.update('acc-bank', 'org-1', { type: 'BANK' }),
      ).rejects.toThrow(
        'A conta do Fature é sempre do tipo provedor de pagamento',
      );
    });
  });

  describe('remove', () => {
    it('never deletes the main account, the provider account or an account with entries', async () => {
      await expect(service.remove('acc-bank', 'org-1')).rejects.toThrow(
        ConflictException,
      );

      prisma.financialAccount.findFirst.mockResolvedValue(
        account({ isMain: false, paymentGatewayAccountId: 'gateway-1' }),
      );
      await expect(service.remove('acc-bank', 'org-1')).rejects.toThrow(
        ConflictException,
      );

      prisma.financialAccount.findFirst.mockResolvedValue(
        account({ isMain: false }),
      );
      prisma.financialEntry.count.mockResolvedValue(3);
      await expect(service.remove('acc-bank', 'org-1')).rejects.toThrow(
        'Esta conta tem 3 lançamentos e não pode ser excluída. Inative-a para que ela não apareça em novos lançamentos.',
      );
      expect(prisma.financialAccount.delete).not.toHaveBeenCalled();
    });

    it('deletes an account without entries', async () => {
      prisma.financialAccount.findFirst.mockResolvedValue(
        account({ isMain: false }),
      );

      await service.remove('acc-bank', 'org-1');

      expect(prisma.financialAccount.delete).toHaveBeenCalledWith({
        where: { id: 'acc-bank' },
      });
    });
  });

  describe('statement', () => {
    it('starts from the balance before the period and keeps the balance after each line', async () => {
      prisma.financialEntry.groupBy
        // Antes do período: +200 −50
        .mockResolvedValueOnce([sums('IN', 200), sums('OUT', 50)])
        // Saldo de hoje e créditos futuros (cabeçalho)
        .mockResolvedValue([]);
      prisma.financialEntry.findMany.mockResolvedValueOnce([
        entry({ id: 'line-1' }),
        entry({
          id: 'line-2',
          direction: 'OUT',
          paidAmount: decimal(30),
          description: 'Tarifa',
        }),
        entry({
          id: 'line-3',
          paidAmount: decimal(100),
          feeAmount: decimal(4.99),
          origin: 'INVOICE',
          settlementDate: new Date('2026-10-30T00:00:00Z'),
        }),
      ]);

      const result = await service.statement('acc-bank', 'org-1', {
        from: '2026-10-05',
        to: '2026-10-31',
      });

      expect(result).toMatchObject({
        from: '2026-10-05',
        to: '2026-10-31',
        previousBalance: 1150,
        totalIn: 195.01,
        totalOut: 30,
        closingBalance: 1315.01,
      });
      expect(
        result.lines.map((line) => [line.id, line.balance, line.isFuture]),
      ).toEqual([
        ['line-1', 1250, false],
        ['line-2', 1220, false],
        ['line-3', 1315.01, true],
      ]);

      const [before] = prisma.financialEntry.groupBy.mock.calls[0];

      expect(before.where.settlementDate).toEqual({
        gte: new Date('2026-10-01T00:00:00Z'),
        lt: new Date('2026-10-05T00:00:00Z'),
      });
    });

    it('starts at the opening day when the period begins before it', async () => {
      const result = await service.statement('acc-bank', 'org-1', {
        from: '2026-09-01',
        to: '2026-10-31',
      });

      expect(result.previousBalance).toBe(1000);
      // Nada antes do saldo inicial: só o saldo de hoje e os créditos futuros
      expect(prisma.financialEntry.groupBy).toHaveBeenCalledTimes(2);
      expect(
        prisma.financialEntry.findMany.mock.calls[0][0].where,
      ).toMatchObject({
        settlementDate: {
          gte: new Date('2026-10-01T00:00:00Z'),
          lte: new Date('2026-10-31T00:00:00Z'),
        },
      });
    });

    it('defaults to the current month and limits the period', async () => {
      await expect(
        service.statement('acc-bank', 'org-1', {}),
      ).resolves.toMatchObject({ from: '2026-10-01', to: '2026-10-31' });

      await expect(
        service.statement('acc-bank', 'org-1', {
          from: '2025-01-01',
          to: '2026-10-31',
        }),
      ).rejects.toThrow('O extrato vai até 366 dias: escolha um período menor');
      await expect(
        service.statement('acc-bank', 'org-1', {
          from: '2026-10-31',
          to: '2026-10-01',
        }),
      ).rejects.toThrow('O início do período deve ser antes do fim');
    });

    it('shows the other account of a transfer', async () => {
      prisma.financialEntry.findMany
        .mockResolvedValueOnce([entry({ id: 'line-1', transferId: 'trf-1' })])
        .mockResolvedValueOnce([
          {
            transferId: 'trf-1',
            account: { id: 'acc-cash', name: 'Dinheiro' },
          },
        ]);

      const result = await service.statement('acc-bank', 'org-1', {
        from: '2026-10-01',
        to: '2026-10-31',
      });

      expect(result.lines[0].counterpartAccount).toEqual({
        id: 'acc-cash',
        name: 'Dinheiro',
      });
    });
  });
});
