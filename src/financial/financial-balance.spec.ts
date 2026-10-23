import { Prisma } from '@prisma/client';
import {
  signedNet,
  sumByDirection,
  sumMovements,
  toAmount,
  withRunningBalance,
} from './financial-balance.js';

const decimal = (value: number) => new Prisma.Decimal(value);

const movement = (direction: string, paid: number, fee = 0) => ({
  direction,
  paidAmount: decimal(paid),
  feeAmount: decimal(fee),
});

describe('financial balance', () => {
  it('moves the account by the net: received minus the fee in, paid out', () => {
    expect(toAmount(signedNet(movement('IN', 100, 1.99)))).toBe(98.01);
    expect(toAmount(signedNet(movement('OUT', 250)))).toBe(-250);
  });

  it('sums the groups of a groupBy by direction', () => {
    const total = sumMovements([
      {
        direction: 'IN',
        _sum: { paidAmount: decimal(300), feeAmount: decimal(3) },
      },
      {
        direction: 'OUT',
        _sum: { paidAmount: decimal(120.5), feeAmount: null },
      },
    ]);

    expect(toAmount(total)).toBe(176.5);
  });

  it('adds exactly with decimals (0,10 + 0,20 = 0,30)', () => {
    const total = sumMovements([
      { direction: 'IN', _sum: { paidAmount: decimal(0.1), feeAmount: null } },
      { direction: 'IN', _sum: { paidAmount: decimal(0.2), feeAmount: null } },
    ]);

    expect(total.equals(decimal(0.3))).toBe(true);
  });

  it('keeps the balance after each movement, from the opening balance', () => {
    const lines = withRunningBalance(decimal(50), [
      movement('IN', 100, 2),
      movement('OUT', 30),
      movement('OUT', 200),
    ]);

    expect(lines.map((line) => toAmount(line.balance))).toEqual([
      148, 118, -82,
    ]);
  });

  it('totals the net in and out separately, both positive', () => {
    const { totalIn, totalOut } = sumByDirection([
      movement('IN', 100, 2),
      movement('IN', 10),
      movement('OUT', 30),
    ]);

    expect(toAmount(totalIn)).toBe(108);
    expect(toAmount(totalOut)).toBe(30);
  });
});
