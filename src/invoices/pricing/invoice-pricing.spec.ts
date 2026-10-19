import {
  InvoicePricingRules,
  buildBankSlipCharge,
  calcInterestPercent,
  calcNominalValue,
  calcItemsDiscount,
  calcSubtotal,
  draftLines,
  getQuote,
  pricingRulesFromDraft,
  pricingRulesFromInvoice,
} from './invoice-pricing.js';
import {
  addDays,
  daysBetween,
  todayInBillingTimezone,
  utcMidnight,
} from './dates.js';

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

  it('adds calendar days across months', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
  });

  it('points to the instant when invoice dates are stored', () => {
    expect(utcMidnight('2026-10-21')).toEqual(new Date('2026-10-21T00:00:00Z'));
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

  describe('validUntil', () => {
    it('lasts until the method discount limit date while the discount applies', () => {
      expect(getQuote(referenceRules(), 'PIX', '2026-10-29').validUntil).toBe(
        '2026-10-30',
      );
    });

    it('lasts until the due date after the discount limit date', () => {
      expect(getQuote(referenceRules(), 'PIX', '2026-10-31').validUntil).toBe(
        '2026-10-31',
      );
    });

    it('lasts until the due date for a method without discount', () => {
      expect(
        getQuote(referenceRules(), 'CREDIT_CARD', '2026-10-29').validUntil,
      ).toBe('2026-10-31');
    });

    it('lasts only the current day when overdue, since interest grows daily', () => {
      expect(getQuote(referenceRules(), 'PIX', '2026-11-10').validUntil).toBe(
        '2026-11-10',
      );
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
      discount: { value: 0.99, until: '2026-10-30' },
      fine: 0.99,
      interestPercent: 1,
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
      value: 0.99,
      until: '2026-10-31',
    });
  });

  it('omits the discount and keeps explicit zero fine and interest when nothing is configured', () => {
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
      fine: 0,
      interestPercent: 0,
    });
  });

  it('does not use the discount of other methods', () => {
    const rules = referenceRules();
    rules.discount.methods = [rules.discount.methods[1]];

    expect(buildBankSlipCharge(rules).discount).toBeNull();
  });
});

describe('pricingRulesFromInvoice', () => {
  it('rebuilds the rules of a stored invoice', () => {
    const stored = {
      items: [
        {
          id: 'item-1',
          name: 'Produto',
          type: 'product',
          price: 100,
          quantity: 1,
          total: 100,
        },
      ],
      dueDate: new Date('2026-10-31T00:00:00Z'),
      discount: referenceRules().discount,
      interestAndFine: referenceRules().interestAndFine,
    };

    expect(pricingRulesFromInvoice(stored)).toEqual(referenceRules());
  });

  it('treats missing discount and charges as none', () => {
    const rules = pricingRulesFromInvoice({
      items: [{ id: 'item-1', total: 50 }],
      dueDate: new Date('2026-10-31T00:00:00Z'),
      discount: null,
      interestAndFine: null,
    });

    expect(rules.discount).toEqual({ items: [], methods: [] });
    expect(getQuote(rules, 'PIX', '2026-11-10').total).toBe(50);
  });
});

describe('pricingRulesFromDraft', () => {
  it('reads the lines, the item discounts and the optional due date of a quote', () => {
    const rules = pricingRulesFromDraft({
      items: [
        { item: { id: 'a', name: 'Site' }, quantity: 1, total: 1000 },
        { item: { id: 'b', name: 'Hospedagem' }, quantity: 2, total: 100 },
      ],
      billing: { dueDate: '2026-11-10' },
      discount: { items: [{ id: 'a', type: 'PERCENTAGE', value: 10 }] },
      interestAndFine: null,
    });

    expect(rules.dueDate).toBe('2026-11-10');
    expect(calcSubtotal(rules.items)).toBe(1100);
    expect(calcItemsDiscount(rules)).toBe(100);
    expect(calcNominalValue(rules)).toBe(1000);
  });

  it('accepts a quote saved halfway', () => {
    const rules = pricingRulesFromDraft({
      items: [{ quantity: 1 }, null],
      billing: null,
      discount: null,
      interestAndFine: null,
    });

    expect(rules).toMatchObject({
      items: [],
      dueDate: '',
      discount: { items: [], methods: [] },
    });
    expect(draftLines('not an array')).toEqual([]);
  });
});
