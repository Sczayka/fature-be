import {
  IssuingInput,
  IssuingPromotion,
  validateIssuingRules,
} from './invoice-rules.js';

const TODAY = '2026-10-15';

function validInput(): IssuingInput {
  return {
    clientId: 'client-1',
    items: [{ id: 'item-1', price: 100, quantity: 1, total: 100 }],
    dueDate: '2026-10-31',
    paymentMethods: ['BANK_SLIP', 'CREDIT_CARD', 'DEBIT_CARD', 'PIX'],
    discount: {
      items: [{ id: 'item-1', type: 'PERCENTAGE', value: 1, promotion: null }],
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
    promotions: [],
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
      promotion: null,
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

describe('validateIssuingRules with promotions', () => {
  /** Promoção de R$ 20 por unidade, até 3 unidades, para o item de R$ 100 × 10. */
  function registered(
    overrides: Partial<IssuingPromotion> = {},
  ): IssuingPromotion {
    return {
      id: 'promo-1',
      name: 'Natal',
      type: 'FIXED',
      value: 20,
      application: 'UNIT',
      maxAmount: null,
      maxQuantity: 3,
      startsAt: '2026-10-01',
      endsAt: '2026-12-31',
      active: true,
      itemIds: ['item-1'],
      ...overrides,
    };
  }

  function promotionInput(promotion: IssuingPromotion | null): IssuingInput {
    const input = validInput();

    input.items = [{ id: 'item-1', price: 100, quantity: 10, total: 1000 }];
    input.discount.items = [
      {
        id: 'item-1',
        type: 'FIXED',
        value: 20,
        promotion: {
          id: 'promo-1',
          name: 'Natal',
          application: 'UNIT',
          maxAmount: null,
          maxQuantity: 3,
        },
      },
    ];
    input.promotions = promotion ? [promotion] : [];

    return input;
  }

  const messages = (input: IssuingInput) =>
    validateIssuingRules(input, TODAY).map((issue) => issue.message);

  it('accepts a promotion applied as it is registered', () => {
    expect(paths(promotionInput(registered()))).toEqual([]);
  });

  it('accepts a fixed promotion greater than the item: the discount is capped', () => {
    const input = promotionInput(registered({ value: 150 }));
    input.discount.items[0].value = 150;

    expect(paths(input)).toEqual([]);
  });

  it.each([
    [null, 'A promoção aplicada ao item não existe mais'],
    [registered({ active: false }), 'A promoção Natal está inativa'],
    [
      registered({ startsAt: '2026-12-01' }),
      'A promoção Natal só vale a partir de 01/12/2026',
    ],
    [
      registered({ endsAt: '2026-10-14' }),
      'A promoção Natal venceu em 14/10/2026',
    ],
    [
      registered({ itemIds: ['item-2'] }),
      'A promoção Natal não vale para este item',
    ],
  ])(
    'rejects a promotion that does not hold today (%#)',
    (promotion, message) => {
      const input = promotionInput(promotion);

      expect(paths(input)).toEqual(['discount.items.0.promotion']);
      expect(messages(input)).toEqual([message]);
    },
  );

  it.each([
    { value: 25 },
    { type: 'PERCENTAGE' as const },
    { application: 'TOTAL' as const },
    { maxAmount: 50 },
    { maxQuantity: null },
  ])('rejects a promotion changed after it was applied: %o', (change) => {
    expect(messages(promotionInput(registered(change)))).toEqual([
      'A promoção Natal mudou depois de aplicada: escolha-a de novo no desconto do item',
    ]);
  });

  it('checks the method discounts against the value left by the promotion', () => {
    const input = promotionInput(registered());
    // 1.000 - 60 da promoção = 940
    input.discount.methods = [
      { method: 'PIX', type: 'FIXED', value: 950, limitDate: '' },
    ];

    expect(paths(input)).toEqual(['discount.methods.0.value']);
  });
});
