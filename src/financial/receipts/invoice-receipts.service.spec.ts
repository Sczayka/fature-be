import { Prisma } from '@prisma/client';
import {
  InvoiceReceiptsService,
  toReceiptValues,
  type ReceiptTransaction,
} from './invoice-receipts.service.js';

const paidAt = new Date('2026-10-16T00:00:00Z');

function transaction(
  overrides: Partial<ReceiptTransaction> = {},
): ReceiptTransaction {
  return {
    id: 'tx-pix',
    type: 'PAYMENT',
    method: 'PIX',
    amount: new Prisma.Decimal(100),
    occurredAt: paidAt,
    status: 'CONFIRMED',
    source: 'GATEWAY',
    charge: {
      feeAmount: 1.99,
      creditDate: null,
      paymentGatewayAccountId: 'gateway-1',
    },
    ...overrides,
  };
}

describe('toReceiptValues', () => {
  it('takes the provider fee from a gateway payment', () => {
    const values = toReceiptValues(transaction(), 0)!;

    expect(values).toMatchObject({
      direction: 'IN',
      description: 'Pagamento de fatura',
      paymentMethod: 'PIX',
      paymentDate: paidAt,
      settlementDate: paidAt,
    });
    expect(values.paidAmount.toNumber()).toBe(100);
    expect(values.feeAmount.toNumber()).toBe(1.99);
  });

  it('settles on the credit date informed by the provider', () => {
    const values = toReceiptValues(
      transaction({
        method: 'CREDIT_CARD',
        charge: {
          feeAmount: 4.99,
          creditDate: new Date('2026-11-16T00:00:00Z'),
          paymentGatewayAccountId: 'gateway-1',
        },
      }),
      0,
    )!;

    expect(values.paymentDate).toEqual(paidAt);
    expect(values.settlementDate).toEqual(new Date('2026-11-16T00:00:00Z'));
  });

  it('falls back to the receipt days of the method without the credit date', () => {
    const values = toReceiptValues(transaction({ method: 'BANK_SLIP' }), 1)!;

    expect(values.settlementDate).toEqual(new Date('2026-10-17T00:00:00Z'));
  });

  it('converts the instant of a card approved on the spot to the billing date', () => {
    // 01:30 em UTC ainda é dia 15 em São Paulo
    const values = toReceiptValues(
      transaction({ occurredAt: new Date('2026-10-16T01:30:00Z') }),
      0,
    )!;

    expect(values.paymentDate).toEqual(new Date('2026-10-15T00:00:00Z'));
  });

  it('has no fee in a manual payment and settles on the day', () => {
    const values = toReceiptValues(
      transaction({
        source: 'OPERATOR',
        method: 'BANK_TRANSFER',
        charge: null,
      }),
      5,
    )!;

    expect(values.feeAmount.toNumber()).toBe(0);
    expect(values.settlementDate).toEqual(paidAt);
  });

  it('turns a refund into money going out, without fee', () => {
    const values = toReceiptValues(
      transaction({ type: 'REFUND', source: 'OPERATOR', charge: null }),
      0,
    )!;

    expect(values).toMatchObject({
      direction: 'OUT',
      description: 'Devolução de fatura',
    });
    expect(values.feeAmount.toNumber()).toBe(0);
  });

  it('never takes a fee bigger than the payment', () => {
    const values = toReceiptValues(
      transaction({
        amount: new Prisma.Decimal(1),
        charge: {
          feeAmount: 1.99,
          creditDate: null,
          paymentGatewayAccountId: 'gateway-1',
        },
      }),
      0,
    )!;

    expect(values.feeAmount.toNumber()).toBe(1);
  });

  it('ignores the transactions that are not confirmed', () => {
    for (const status of ['PENDING_REVIEW', 'REJECTED', 'CANCELLED']) {
      expect(toReceiptValues(transaction({ status }), 0)).toBeNull();
    }
  });
});

describe('InvoiceReceiptsService', () => {
  let tx: any;
  let service: InvoiceReceiptsService;

  const invoice = (transactions: ReceiptTransaction[]) => ({
    organizationId: 'org-1',
    clientId: 'client-1',
    transactions,
  });

  beforeEach(() => {
    tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      invoice: {
        findUnique: vi.fn().mockResolvedValue(invoice([transaction()])),
      },
      financialEntry: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
      },
      financialAccount: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'main', isMain: true, paymentGatewayAccountId: null },
          {
            id: 'provider',
            isMain: false,
            paymentGatewayAccountId: 'gateway-1',
          },
        ]),
        create: vi.fn().mockResolvedValue({}),
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      financialCategory: {
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      paymentGatewayAccount: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([]),
      },
      paymentGatewayMethod: {
        findMany: vi.fn().mockResolvedValue([
          {
            paymentGatewayAccountId: 'gateway-1',
            method: 'PIX',
            receiptDays: 0,
          },
        ]),
      },
    };
    service = new InvoiceReceiptsService();
  });

  it('records a confirmed gateway payment in the provider account, with the client', async () => {
    await service.sync(tx, 'inv-1');

    const { data } = tx.financialEntry.create.mock.calls[0][0];

    expect(data).toMatchObject({
      organizationId: 'org-1',
      origin: 'INVOICE',
      status: 'PAID',
      direction: 'IN',
      accountId: 'provider',
      invoiceId: 'inv-1',
      invoiceTransactionId: 'tx-pix',
      clientId: 'client-1',
    });
    expect(data.feeAmount.toNumber()).toBe(1.99);
  });

  it('records a manual payment and a refund in the main account', async () => {
    tx.invoice.findUnique.mockResolvedValue(
      invoice([
        transaction({ id: 'tx-transfer', source: 'OPERATOR', charge: null }),
        transaction({
          id: 'tx-refund',
          type: 'REFUND',
          source: 'OPERATOR',
          charge: null,
        }),
      ]),
    );

    await service.sync(tx, 'inv-1');

    expect(
      tx.financialEntry.create.mock.calls.map(([{ data }]: any) => [
        data.invoiceTransactionId,
        data.direction,
        data.accountId,
      ]),
    ).toEqual([
      ['tx-transfer', 'IN', 'main'],
      ['tx-refund', 'OUT', 'main'],
    ]);
  });

  it('updates the values of an existing receipt without touching the account, category or notes', async () => {
    tx.financialEntry.findMany.mockResolvedValue([
      { id: 'entry-1', invoiceTransactionId: 'tx-pix', status: 'PAID' },
    ]);

    await service.sync(tx, 'inv-1');

    expect(tx.financialEntry.create).not.toHaveBeenCalled();

    const { where, data } = tx.financialEntry.update.mock.calls[0][0];

    expect(where).toEqual({ id: 'entry-1' });
    expect(data).toMatchObject({ status: 'PAID', direction: 'IN' });
    expect(data).not.toHaveProperty('accountId');
    expect(data).not.toHaveProperty('categoryId');
    expect(data).not.toHaveProperty('notes');
  });

  it('cancels the receipt of a transaction that is no longer confirmed', async () => {
    tx.invoice.findUnique.mockResolvedValue(
      invoice([transaction({ source: 'OPERATOR', status: 'CANCELLED' })]),
    );
    tx.financialEntry.findMany.mockResolvedValue([
      { id: 'entry-1', invoiceTransactionId: 'tx-pix', status: 'PAID' },
    ]);

    await service.sync(tx, 'inv-1');

    expect(tx.financialEntry.update).toHaveBeenCalledWith({
      where: { id: 'entry-1' },
      data: { status: 'CANCELLED' },
    });
    expect(tx.financialEntry.create).not.toHaveBeenCalled();
  });

  it('does nothing for a proof still waiting for the review', async () => {
    tx.invoice.findUnique.mockResolvedValue(
      invoice([
        transaction({
          source: 'CHECKOUT',
          status: 'PENDING_REVIEW',
          amount: null,
          occurredAt: null,
          charge: null,
        }),
      ]),
    );

    await service.sync(tx, 'inv-1');

    expect(tx.financialEntry.create).not.toHaveBeenCalled();
    expect(tx.financialEntry.update).not.toHaveBeenCalled();
  });

  it('creates the default accounts when the organization has none yet', async () => {
    tx.financialAccount.findMany
      // Contas dos recebimentos: nenhuma
      .mockResolvedValueOnce([])
      // A configuração confere as contas existentes
      .mockResolvedValueOnce([])
      // Depois da configuração
      .mockResolvedValueOnce([
        { id: 'main', isMain: true, paymentGatewayAccountId: null },
        { id: 'provider', isMain: false, paymentGatewayAccountId: 'gateway-1' },
      ]);

    await service.sync(tx, 'inv-1');

    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.financialAccount.createMany).toHaveBeenCalled();
    expect(tx.financialEntry.create.mock.calls[0][0].data.accountId).toBe(
      'provider',
    );
  });

  it('skips invoices without transactions', async () => {
    tx.invoice.findUnique.mockResolvedValue(invoice([]));

    await service.sync(tx, 'inv-1');

    expect(tx.financialEntry.findMany).not.toHaveBeenCalled();
  });
});
