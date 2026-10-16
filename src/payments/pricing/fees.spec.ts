import { calcRateAmount, calcSplitAmount } from './fees.js';

describe('calcRateAmount', () => {
  it('adds the fixed part to the percentage over the value', () => {
    expect(calcRateAmount({ fixed: 0.49, percent: 4.29 }, 100)).toBe(4.78);
  });

  it('rounds to cents', () => {
    expect(calcRateAmount({ fixed: 0, percent: 1.89 }, 33.33)).toBe(0.63);
  });
});

describe('calcSplitAmount', () => {
  it('sends the difference between the organization fee and the provider cost', () => {
    expect(calcSplitAmount(1, 0.3)).toBe(0.7);
  });

  it('sends nothing when the fee equals the cost', () => {
    expect(calcSplitAmount(1.99, 1.99)).toBe(0);
  });

  it('never sends a negative split when the fee is below the cost', () => {
    expect(calcSplitAmount(0.5, 1.99)).toBe(0);
  });
});
