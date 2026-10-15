import {
  InvoicePricingRules,
  buildBankSlipCharge,
  calcInterestPercent,
  calcNominalValue,
  getQuote,
} from './invoice-pricing.js';
import { daysBetween, todayInBillingTimezone } from './dates.js';

/** Payload de referência (descontos por método deduplicados). */
function referenceRules(): InvoicePricingRules {
  return {
    items: [{ id: 'item-1', total: 100 }],
    dueDate: '2026-10-31',
    discount: {
      items: [{ id: 'item-1', type: 'PERCENTAGE', value: 1 }],
      methods: [
        {
          method: 'BANK_SLIP',
          type: 'PERCENTAGE',
          value: 1,
          limitDate: '2026-10-30',
        },
        {
          method: 'PIX',
          type: 'PERCENTAGE',
          value: 1,
          limitDate: '2026-10-30',
        },
      ],
    },
    interestAndFine: {
      fineType: 'PERCENTAGE',
      fineValue: 1,
      interestType: 'PERCENTAGE',
      interestValue: 1,
    },
  };
}

describe('dates', () => {
  it('counts calendar days between date-only strings', () => {
    expect(daysBetween('2026-10-30', '2026-10-31')).toBe(1);
    expect(daysBetween('2026-10-31', '2026-11-10')).toBe(10);
    expect(daysBetween('2026-10-31', '2026-10-31')).toBe(0);
  });

  it('uses the Sao Paulo calendar for "today"', () => {
    // 02:00 UTC is still the previous day in Sao Paulo (UTC-3)
    expect(todayInBillingTimezone(new Date('2026-10-16T02:00:00Z'))).toBe(
      '2026-10-15',
    );
  });
});

describe('calcNominalValue', () => {
  it('subtracts the item discounts from the subtotal', () => {
    expect(calcNominalValue(referenceRules())).toBe(99);
  });

  it('clamps a fixed item discount to the item total', () => {
    const rules = referenceRules();
    rules.discount.items = [{ id: 'item-1', type: 'FIXED', value: 150 }];

    expect(calcNominalValue(rules)).toBe(0);
  });
});

describe('getQuote', () => {
  it('applies the method discount over the nominal value until its limit date', () => {
    expect(getQuote(referenceRules(), 'PIX', '2026-10-29')).toMatchObject({
      phase: 'ON_TIME',
      subtotal: 100,
      itemsDiscount: 1,
      nominalValue: 99,
      methodDiscount: 0.99,
      total: 98.01,
    });
  });

  it('keeps the item discount after the method limit date', () => {
    expect(getQuote(referenceRules(), 'PIX', '2026-10-31').total).toBe(99);
  });

  it('ignores the discount of other methods', () => {
    expect(getQuote(referenceRules(), 'CREDIT_CARD', '2026-10-29').total).toBe(
      99,
    );
  });

  it('treats an empty limit date as valid until the due date', () => {
    const rules = referenceRules();
    rules.discount.methods[1].limitDate = '';

    expect(getQuote(rules, 'PIX', '2026-10-31').methodDiscount).toBe(0.99);
  });

  it('keeps the item discount and adds fine plus pro rata interest after the due date', () => {
    expect(getQuote(referenceRules(), 'PIX', '2026-11-10')).toMatchObject({
      phase: 'OVERDUE',
      itemsDiscount: 1,
      nominalValue: 99,
      methodDiscount: 0,
      fine: 0.99,
      interest: 0.33,
      daysLate: 10,
      total: 100.32,
    });
  });
});

describe('calcInterestPercent', () => {
  it('converts fixed monthly interest into a percentage of the nominal value', () => {
    const rules = referenceRules();
    rules.items = [{ id: 'item-1', total: 300 }];
    rules.discount.items = [];
    rules.interestAndFine.interestType = 'FIXED';
    rules.interestAndFine.interestValue = 5;

    expect(calcInterestPercent(rules)).toBe(1.67);
  });
});

describe('buildBankSlipCharge', () => {
  it('uses the nominal value and the bank slip discount with its deadline', () => {
    expect(buildBankSlipCharge(referenceRules())).toEqual({
      value: 99,
      dueDate: '2026-10-31',
      discount: { type: 'FIXED', value: 0.99, dueDateLimitDays: 1 },
      fine: { type: 'FIXED', value: 0.99 },
      interest: { value: 1 },
    });
  });

  it('keeps the bank slip on par with the quote before the limit date', () => {
    const rules = referenceRules();
    const charge = buildBankSlipCharge(rules);

    expect(charge.value - charge.discount!.value).toBeCloseTo(
      getQuote(rules, 'BANK_SLIP', '2026-10-30').total,
      2,
    );
  });

  it('uses the due date as deadline when the bank slip discount has no limit date', () => {
    const rules = referenceRules();
    rules.discount.methods[0].limitDate = '';

    expect(buildBankSlipCharge(rules).discount).toEqual({
      type: 'FIXED',
      value: 0.99,
      dueDateLimitDays: 0,
    });
  });

  it('omits the discount and sends explicit zero fine and interest when nothing is configured', () => {
    const rules = referenceRules();
    rules.discount = { items: [], methods: [] };
    rules.interestAndFine = {
      fineType: 'PERCENTAGE',
      fineValue: 0,
      interestType: 'PERCENTAGE',
      interestValue: 0,
    };

    expect(buildBankSlipCharge(rules)).toEqual({
      value: 100,
      dueDate: '2026-10-31',
      discount: null,
      fine: { type: 'FIXED', value: 0 },
      interest: { value: 0 },
    });
  });

  it('does not use the discount of other methods', () => {
    const rules = referenceRules();
    rules.discount.methods = [rules.discount.methods[1]];

    expect(buildBankSlipCharge(rules).discount).toBeNull();
  });
});
