import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AvailablePromotionsQueryDto } from './available-promotions-query.dto.js';
import { CreatePromotionDto } from './create-promotion.dto.js';

const validPayload = {
  name: ' Natal ',
  type: 'PERCENTAGE',
  value: 10,
  application: 'TOTAL',
  maxAmount: 50,
  maxQuantity: 3,
  startsAt: '2026-12-01',
  endsAt: '2026-12-31',
  itemIds: ['item-1'],
};

async function errorsOf(payload: Record<string, unknown>) {
  const errors = await validate(plainToInstance(CreatePromotionDto, payload));

  return errors.map((error) => error.property);
}

describe('CreatePromotionDto', () => {
  it('accepts a complete promotion and trims the name', async () => {
    const dto = plainToInstance(CreatePromotionDto, validPayload);

    expect(await validate(dto)).toEqual([]);
    expect(dto.name).toBe('Natal');
  });

  it('accepts no ceiling, no maximum quantity and no validity', async () => {
    expect(
      await errorsOf({
        ...validPayload,
        maxAmount: null,
        maxQuantity: null,
        startsAt: '',
        endsAt: null,
      }),
    ).toEqual([]);
  });

  it.each([
    ['value', { value: 120 }],
    ['value', { value: 0 }],
    ['application', { application: 'LINE' }],
    ['maxAmount', { maxAmount: 0 }],
    ['maxQuantity', { maxQuantity: 1.5 }],
    ['endsAt', { endsAt: '31/12/2026' }],
    ['itemIds', { itemIds: [] }],
    ['itemIds', { itemIds: ['item-1', 'item-1'] }],
  ])('rejects an invalid %s', async (property, change) => {
    expect(await errorsOf({ ...validPayload, ...change })).toEqual([property]);
  });
});

describe('AvailablePromotionsQueryDto', () => {
  it.each([
    ['comma separated', { itemIds: 'item-1, item-2' }],
    ['repeated', { itemIds: ['item-1', 'item-2'] }],
  ])('reads the item ids %s', (_, query) => {
    expect(plainToInstance(AvailablePromotionsQueryDto, query).itemIds).toEqual(
      ['item-1', 'item-2'],
    );
  });

  it('defaults to no items', () => {
    expect(plainToInstance(AvailablePromotionsQueryDto, {}).itemIds).toEqual(
      [],
    );
  });
});
