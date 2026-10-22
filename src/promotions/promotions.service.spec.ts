import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PromotionsService } from './promotions.service.js';
import type { CreatePromotionDto } from './dto/create-promotion.dto.js';
import type { ListPromotionsQueryDto } from './dto/list-promotions-query.dto.js';

// PrismaService abre o pool do banco ao ser importado; os testes usam mocks
vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

const stored = {
  id: 'promo-1',
  name: 'Natal',
  type: 'FIXED',
  value: 20,
  application: 'UNIT',
  maxAmount: null,
  maxQuantity: 3,
  startsAt: new Date('2026-12-01T00:00:00Z'),
  endsAt: new Date('2026-12-31T00:00:00Z'),
  active: true,
  organizationId: 'org-1',
  items: [
    { item: { id: 'item-1', name: 'Panetone', type: 'product', price: 100 } },
  ],
};

function buildDto(
  overrides: Partial<CreatePromotionDto> = {},
): CreatePromotionDto {
  return {
    name: 'Natal',
    type: 'FIXED',
    value: 20,
    application: 'UNIT',
    maxAmount: null,
    maxQuantity: 3,
    startsAt: '2026-12-01',
    endsAt: '2026-12-31',
    itemIds: ['item-1'],
    ...overrides,
  };
}

describe('PromotionsService', () => {
  let prisma: any;
  let service: PromotionsService;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));

    prisma = {
      promotion: {
        create: vi.fn().mockResolvedValue(stored),
        findFirst: vi.fn().mockImplementation(({ where }) =>
          // Sem duplicado de nome; a própria promoção existe
          Promise.resolve(where.id ? stored : null),
        ),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        update: vi.fn().mockResolvedValue(stored),
        delete: vi.fn().mockResolvedValue(stored),
      },
      promotionItem: { deleteMany: vi.fn() },
      item: { count: vi.fn().mockResolvedValue(1) },
      invoice: { count: vi.fn().mockResolvedValue(0) },
      $transaction: vi.fn((callback) => callback(prisma)),
    };

    service = new PromotionsService(prisma);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('create', () => {
    it('creates the promotion with its items and the validity at UTC midnight', async () => {
      const promotion = await service.create('org-1', buildDto());

      expect(prisma.promotion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            name: 'Natal',
            type: 'FIXED',
            value: 20,
            application: 'UNIT',
            maxAmount: null,
            maxQuantity: 3,
            startsAt: new Date('2026-12-01T00:00:00Z'),
            endsAt: new Date('2026-12-31T00:00:00Z'),
            active: undefined,
            organizationId: 'org-1',
            items: { create: [{ itemId: 'item-1' }] },
          },
        }),
      );
      expect(promotion).toMatchObject({
        startsAt: '2026-12-01',
        endsAt: '2026-12-31',
        items: [{ id: 'item-1', name: 'Panetone' }],
      });
    });

    it('accepts a promotion without ceiling, maximum quantity or validity', async () => {
      await service.create(
        'org-1',
        buildDto({
          maxAmount: undefined,
          maxQuantity: undefined,
          startsAt: '',
          endsAt: null,
        }),
      );

      expect(prisma.promotion.create.mock.calls[0][0].data).toMatchObject({
        maxAmount: null,
        maxQuantity: null,
        startsAt: null,
        endsAt: null,
      });
    });

    it('rejects a name already used in the organization, ignoring the case', async () => {
      prisma.promotion.findFirst.mockResolvedValue({ active: true });

      await expect(
        service.create('org-1', buildDto({ name: 'NATAL' })),
      ).rejects.toThrow(
        new ConflictException('Já existe uma promoção com este nome.'),
      );
      expect(prisma.promotion.findFirst).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          name: { equals: 'NATAL', mode: 'insensitive' },
        },
        select: { active: true },
      });
    });

    it('rejects a validity that ends before it starts', async () => {
      await expect(
        service.create('org-1', buildDto({ endsAt: '2026-11-30' })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.promotion.create).not.toHaveBeenCalled();
    });

    it('rejects items of another organization', async () => {
      prisma.item.count.mockResolvedValue(1);

      await expect(
        service.create('org-1', buildDto({ itemIds: ['item-1', 'item-9'] })),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.item.count).toHaveBeenCalledWith({
        where: { id: { in: ['item-1', 'item-9'] }, organizationId: 'org-1' },
      });
    });

    it('turns a concurrent duplicate name into a conflict', async () => {
      prisma.promotion.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(service.create('org-1', buildDto())).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  it('lists the promotions with the number of items and the dates as days', async () => {
    const { items: _items, ...row } = stored;
    prisma.promotion.findMany.mockResolvedValue([
      { ...row, _count: { items: 2 } },
    ]);
    prisma.promotion.count.mockResolvedValue(1);

    const result = await service.findAll('org-1', {
      page: 1,
      limit: 10,
      name: 'nat',
      active: true,
    } as ListPromotionsQueryDto);

    expect(prisma.promotion.findMany.mock.calls[0][0].where).toEqual({
      organizationId: 'org-1',
      name: { contains: 'nat', mode: 'insensitive' },
      active: true,
    });
    expect(result.data).toEqual([
      expect.objectContaining({
        startsAt: '2026-12-01',
        endsAt: '2026-12-31',
        itemsCount: 2,
      }),
    ]);
    expect(result.data[0]).not.toHaveProperty('_count');
  });

  describe('available', () => {
    it('offers the active promotions valid today for the items of the invoice', async () => {
      prisma.promotion.findMany.mockResolvedValue([
        {
          ...stored,
          startsAt: null,
          items: [{ itemId: 'item-1' }],
        },
      ]);

      const promotions = await service.available('org-1', ['item-1', 'item-2']);
      const today = new Date('2026-10-15T00:00:00Z');

      expect(prisma.promotion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: 'org-1',
            active: true,
            AND: [
              { OR: [{ startsAt: null }, { startsAt: { lte: today } }] },
              { OR: [{ endsAt: null }, { endsAt: { gte: today } }] },
            ],
            items: { some: { itemId: { in: ['item-1', 'item-2'] } } },
          },
          orderBy: { name: 'asc' },
        }),
      );
      expect(promotions).toEqual([
        {
          id: 'promo-1',
          name: 'Natal',
          type: 'FIXED',
          value: 20,
          application: 'UNIT',
          maxAmount: null,
          maxQuantity: 3,
          startsAt: null,
          endsAt: '2026-12-31',
          active: true,
          organizationId: 'org-1',
          itemIds: ['item-1'],
        },
      ]);
    });

    it('does not query without items', async () => {
      await expect(service.available('org-1', [])).resolves.toEqual([]);
      expect(prisma.promotion.findMany).not.toHaveBeenCalled();
    });
  });

  it('does not return promotions of another organization', async () => {
    prisma.promotion.findFirst.mockResolvedValue(null);

    await expect(service.findOne('promo-1', 'org-2')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  describe('update', () => {
    it('replaces the items and keeps the fields that were not sent', async () => {
      await service.update('promo-1', 'org-1', {
        active: false,
        itemIds: ['item-2'],
      });

      expect(prisma.promotionItem.deleteMany).toHaveBeenCalledWith({
        where: { promotionId: 'promo-1' },
      });
      expect(prisma.promotion.update.mock.calls[0][0].data).toMatchObject({
        name: undefined,
        value: undefined,
        maxAmount: undefined,
        startsAt: new Date('2026-12-01T00:00:00Z'),
        endsAt: new Date('2026-12-31T00:00:00Z'),
        active: false,
        items: { create: [{ itemId: 'item-2' }] },
      });
    });

    it('clears the ceiling, the maximum quantity and the validity sent as null', async () => {
      await service.update('promo-1', 'org-1', {
        maxAmount: null,
        maxQuantity: null,
        startsAt: null,
        endsAt: null,
      });

      expect(prisma.promotionItem.deleteMany).not.toHaveBeenCalled();
      expect(prisma.promotion.update.mock.calls[0][0].data).toMatchObject({
        maxAmount: null,
        maxQuantity: null,
        startsAt: null,
        endsAt: null,
        items: undefined,
      });
    });

    it('checks the validity against the saved start date', async () => {
      await expect(
        service.update('promo-1', 'org-1', { endsAt: '2026-11-15' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a percentage above 100 when only the type changes', async () => {
      await expect(
        service.update('promo-1', 'org-1', { type: 'PERCENTAGE' }),
      ).resolves.toBeDefined();

      prisma.promotion.findFirst.mockResolvedValue({ ...stored, value: 150 });

      await expect(
        service.update('promo-1', 'org-1', { type: 'PERCENTAGE' }),
      ).rejects.toThrow('O desconto em porcentagem não pode passar de 100%');
    });
  });

  describe('remove', () => {
    it('deletes a promotion never used in an invoice', async () => {
      await service.remove('promo-1', 'org-1');

      expect(prisma.invoice.count).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          discount: {
            path: ['items'],
            array_contains: [{ promotion: { id: 'promo-1' } }],
          },
        },
      });
      expect(prisma.promotion.delete).toHaveBeenCalledWith({
        where: { id: 'promo-1' },
      });
    });

    it('keeps a promotion used in invoices and suggests inactivating it', async () => {
      prisma.invoice.count.mockResolvedValue(2);

      await expect(service.remove('promo-1', 'org-1')).rejects.toThrow(
        new ConflictException(
          'Esta promoção foi usada em 2 cobranças e não pode ser excluída. Inative-a para que ela não apareça em novas cobranças.',
        ),
      );
      expect(prisma.promotion.delete).not.toHaveBeenCalled();
    });
  });
});
