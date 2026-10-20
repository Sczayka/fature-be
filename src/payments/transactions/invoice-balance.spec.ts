import { Prisma } from '@prisma/client';
import type { InvoicePricingRules } from '../../invoices/pricing/invoice-pricing.js';
import {
  BalanceTransaction,
  computeInvoiceBalance,
  lockedMethod,
} from './invoice-balance.js';

const TODAY = '2026-10-20';

/** Fatura de 100, vencimento em 30/10, sem desconto nem encargos. */
const rules: InvoicePricingRules = {
  items: [{ id: 'item-1', total: 100 }],
  dueDate: '2026-10-30',
  discount: { items: [], methods: [] },
  interestAndFine: {
    fineType: 'PERCENTAGE',
    fineValue: 0,
    interestType: 'PERCENTAGE',
    interestValue: 0,
  },
};

let sequence = 0;

function transaction(
  overrides: Partial<Omit<BalanceTransaction, 'amount'>> & {
    amount?: string | number | null;
  } = {},
): BalanceTransaction {
  sequence += 1;

  const { amount = 100, ...rest } = overrides;

  return {
    id: `tx-${sequence}`,
    type: 'PAYMENT',
    status: 'CONFIRMED',
    source: 'GATEWAY',
    method: 'PIX',
    occurredAt: new Date('2026-10-18T00:00:00Z'),
    createdAt: new Date(Date.UTC(2026, 9, 18, 12, 0, sequence)),
    chargeId: `charge-${sequence}`,
    ...rest,
    amount: amount == null ? null : new Prisma.Decimal(amount),
  };
}

describe('computeInvoiceBalance', () => {
  it('has nothing received and no amount due without transactions', () => {
    expect(computeInvoiceBalance(rules, [], TODAY)).toEqual({
      totalPaid: 0,
      totalRefunded: 0,
      net: 0,
      due: null,
      balance: null,
      excess: 0,
      settledBy: null,
    });
  });

  it('settles with a single provider payment', () => {
    const pix = transaction({ amount: 100 });

    expect(computeInvoiceBalance(rules, [pix], TODAY)).toEqual({
      totalPaid: 100,
      totalRefunded: 0,
      net: 100,
      due: 100,
      balance: 0,
      excess: 0,
      settledBy: pix,
    });
  });

  it('keeps the first provider payment and turns the second into excess', () => {
    const pix = transaction({ method: 'PIX' });
    const bankSlip = transaction({
      method: 'BANK_SLIP',
      occurredAt: new Date('2026-10-19T00:00:00Z'),
    });

    const balance = computeInvoiceBalance(rules, [bankSlip, pix], TODAY);

    expect(balance.settledBy).toBe(pix);
    expect(balance).toMatchObject({
      net: 200,
      due: 100,
      balance: -100,
      excess: 100,
    });
  });

  it('stays settled after the excess is refunded', () => {
    const pix = transaction();
    const bankSlip = transaction({
      method: 'BANK_SLIP',
      occurredAt: new Date('2026-10-19T00:00:00Z'),
    });
    const refund = transaction({
      type: 'REFUND',
      source: 'OPERATOR',
      chargeId: null,
    });

    const balance = computeInvoiceBalance(
      rules,
      [pix, bankSlip, refund],
      TODAY,
    );

    expect(balance.settledBy).toBe(pix);
    expect(balance).toMatchObject({
      totalPaid: 200,
      totalRefunded: 100,
      net: 100,
      due: 100,
      excess: 0,
    });
  });

  it('ignores transactions that are not confirmed', () => {
    const balance = computeInvoiceBalance(
      rules,
      [
        transaction({
          status: 'PENDING_REVIEW',
          source: 'CHECKOUT',
          amount: null,
          occurredAt: null,
        }),
        transaction({ status: 'REJECTED', source: 'CHECKOUT' }),
        transaction({ status: 'CANCELLED', source: 'OPERATOR' }),
      ],
      TODAY,
    );

    expect(balance).toMatchObject({
      totalPaid: 0,
      net: 0,
      excess: 0,
      settledBy: null,
    });
    // A que aguarda conferência já define a forma: o devido é o valor de hoje por ela
    expect(balance.due).toBe(100);
    expect(balance.balance).toBe(100);
  });

  it('adds amounts with exact decimals', () => {
    const balance = computeInvoiceBalance(
      { ...rules, items: [{ id: 'item-1', total: 0.3 }] },
      [
        transaction({ source: 'OPERATOR', amount: '0.10' }),
        transaction({ source: 'OPERATOR', amount: '0.20' }),
      ],
      TODAY,
    );

    expect(balance.totalPaid).toBe(0.3);
    expect(balance.settledBy).not.toBeNull();
    expect(balance.balance).toBe(0);
  });

  it('settles a manual payment only when the parts reach the amount of the day', () => {
    const first = transaction({ source: 'OPERATOR', amount: 60 });
    const second = transaction({
      source: 'OPERATOR',
      amount: 30,
      occurredAt: new Date('2026-10-19T00:00:00Z'),
    });

    const balance = computeInvoiceBalance(rules, [first, second], TODAY);

    expect(balance.settledBy).toBeNull();
    expect(balance).toMatchObject({ net: 90, due: 100, balance: 10 });
  });

  it('is no longer settled when refunds bring the net below the amount due', () => {
    const balance = computeInvoiceBalance(
      rules,
      [
        transaction(),
        transaction({ type: 'REFUND', source: 'OPERATOR', amount: 40 }),
      ],
      TODAY,
    );

    expect(balance.settledBy).toBeNull();
    expect(balance).toMatchObject({ net: 60, due: 100, balance: 40 });
  });
});

/** PIX de 500 com 10% de desconto até D (20/10), vencimento em 30/10, multa de 2% e juros de 1% ao mês. */
describe('computeInvoiceBalance with manual payments', () => {
  const manualRules: InvoicePricingRules = {
    items: [{ id: 'item-1', total: 500 }],
    dueDate: '2026-10-30',
    discount: {
      items: [],
      methods: [
        {
          method: 'PIX',
          type: 'PERCENTAGE',
          value: 10,
          limitDate: '2026-10-20',
        },
      ],
    },
    interestAndFine: {
      fineType: 'PERCENTAGE',
      fineValue: 2,
      interestType: 'PERCENTAGE',
      interestValue: 1,
    },
  };

  const manualPix = (amount: number, day: string) =>
    transaction({
      source: 'OPERATOR',
      method: 'PIX',
      chargeId: null,
      amount,
      occurredAt: new Date(`${day}T00:00:00Z`),
    });

  it('settles on D with 300 on D-1 and 150 on D, for the amount with the discount', () => {
    const last = manualPix(150, '2026-10-20');

    const balance = computeInvoiceBalance(
      manualRules,
      [manualPix(300, '2026-10-19'), last],
      '2026-10-22',
    );

    expect(balance.settledBy).toBe(last);
    expect(balance).toMatchObject({
      net: 450,
      due: 450,
      balance: 0,
      excess: 0,
    });
  });

  it('loses the discount when the part that completes comes after the limit date', () => {
    const last = manualPix(200, '2026-10-21');

    const balance = computeInvoiceBalance(
      manualRules,
      [manualPix(300, '2026-10-20'), last],
      '2026-10-22',
    );

    expect(balance.settledBy).toBe(last);
    expect(balance).toMatchObject({ net: 500, due: 500, excess: 0 });
  });

  it('is not settled with 300 and 100: the balance is the value of today minus 400', () => {
    const parts = [manualPix(300, '2026-10-19'), manualPix(100, '2026-10-20')];

    expect(
      computeInvoiceBalance(manualRules, parts, '2026-10-20'),
    ).toMatchObject({ settledBy: null, net: 400, due: 450, balance: 50 });
    // Depois da data limite, o valor de hoje já não tem o desconto
    expect(
      computeInvoiceBalance(manualRules, parts, '2026-10-22'),
    ).toMatchObject({ settledBy: null, net: 400, due: 500, balance: 100 });
  });

  it('turns what goes beyond the amount into excess', () => {
    const balance = computeInvoiceBalance(
      manualRules,
      [manualPix(600, '2026-10-19')],
      '2026-10-22',
    );

    expect(balance.settledBy).not.toBeNull();
    expect(balance).toMatchObject({ net: 600, due: 450, excess: 150 });
  });

  it('charges fine and interest until the date of the last part after the due date', () => {
    // 10 dias de atraso na última parte: 500 + 10 de multa + 1,67 de juros
    const last = manualPix(211.67, '2026-11-09');

    const balance = computeInvoiceBalance(
      manualRules,
      [manualPix(300, '2026-11-04'), last],
      '2026-11-15',
    );

    expect(balance.settledBy).toBe(last);
    expect(balance).toMatchObject({ net: 511.67, due: 511.67, excess: 0 });
  });
});

describe('lockedMethod', () => {
  it('is the method of the oldest payment confirmed or awaiting review', () => {
    expect(
      lockedMethod([
        transaction({ status: 'REJECTED', method: 'PIX' }),
        transaction({ status: 'PENDING_REVIEW', method: 'BANK_TRANSFER' }),
        transaction({ status: 'CONFIRMED', method: 'PIX' }),
      ]),
    ).toBe('BANK_TRANSFER');
    expect(lockedMethod([transaction({ type: 'REFUND' })])).toBeNull();
  });
});
