import { IssuingInput, validateIssuingRules } from './invoice-rules.js';

const TODAY = '2026-10-15';

function validInput(): IssuingInput {
  return {
    clientId: 'client-1',
    items: [{ id: 'item-1', price: 100, quantity: 1, total: 100 }],
    dueDate: '2026-10-31',
    paymentMethods: ['BANK_SLIP', 'CREDIT_CARD', 'DEBIT_CARD', 'PIX'],
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
          method: 'CREDIT_CARD',
          type: 'PERCENTAGE',
          value: 1,
          limitDate: '2026-10-30',
        },
        {
          method: 'DEBIT_CARD',
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

const paths = (input: IssuingInput) =>
  validateIssuingRules(input, TODAY).map((issue) => issue.path);

describe('validateIssuingRules', () => {
  it('accepts the reference payload with one discount per method', () => {
    expect(validateIssuingRules(validInput(), TODAY)).toEqual([]);
  });

  it('rejects the reference payload as sent (BANK_SLIP repeated in discount.methods)', () => {
    const input = validInput();
    input.discount.methods = input.discount.methods.map((rule) => ({
      ...rule,
      method: 'BANK_SLIP' as const,
    }));

    expect(paths(input)).toEqual([
      'discount.methods.1.method',
      'discount.methods.2.method',
      'discount.methods.3.method',
    ]);
  });

  it('requires a registered client', () => {
    const input = validInput();
    input.clientId = '';

    expect(paths(input)).toEqual(['client.id']);
  });

  it('rejects an item total that differs from price x quantity', () => {
    const input = validInput();
    input.items[0].total = 90;

    expect(paths(input)).toContain('items.0.total');
  });

  it('rejects a repeated item', () => {
    const input = validInput();
    input.items.push({ ...input.items[0] });
    input.discount.items = [];

    expect(paths(input)).toEqual(['items.1.item.id']);
  });

  it('rejects a due date in the past', () => {
    const input = validInput();
    input.dueDate = '2026-10-14';
    input.discount = { items: [], methods: [] };

    expect(paths(input)).toEqual(['billing.dueDate']);
  });

  it('rejects a discount for a method that is not enabled', () => {
    const input = validInput();
    input.paymentMethods = ['BANK_SLIP'];
    input.discount.methods = input.discount.methods.slice(0, 2);

    expect(paths(input)).toEqual(['discount.methods.1.method']);
  });

  it('rejects a discount for an item that is not in the invoice', () => {
    const input = validInput();
    input.discount.items[0].id = 'other';

    expect(paths(input)).toEqual(['discount.items.0.id']);
  });

  it('validates method limit dates against today and the due date', () => {
    const input = validInput();
    input.discount.methods[0].limitDate = '2026-11-01';
    input.discount.methods[3].limitDate = '2026-10-01';

    expect(paths(input)).toEqual([
      'discount.methods.0.limitDate',
      'discount.methods.3.limitDate',
    ]);
  });

  it('rejects fixed discounts greater than their base', () => {
    const input = validInput();
    input.discount.items[0] = {
      id: 'item-1',
      type: 'FIXED',
      value: 101,
    };
    input.discount.methods = [
      { method: 'PIX', type: 'FIXED', value: 100, limitDate: '' },
    ];

    expect(paths(input)).toEqual([
      'discount.items.0.value',
      'discount.methods.0.value',
    ]);
  });

  it('ignores zero value discounts', () => {
    const input = validInput();
    input.discount.methods[0] = {
      method: 'BANK_SLIP',
      type: 'FIXED',
      value: 0,
      limitDate: '2026-10-01',
    };

    expect(paths(input)).toEqual([]);
  });

  it('allows the bank slip discount deadline to differ from the other methods', () => {
    const input = validInput();
    input.discount.methods[0].limitDate = '2026-10-25';
    input.discount.methods[3].limitDate = '';

    expect(paths(input)).toEqual([]);
  });
});
