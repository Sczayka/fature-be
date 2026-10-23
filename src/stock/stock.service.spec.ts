import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ListQueryDto } from '../common/dto/list-query.dto.js';
import { StockService } from './stock.service.js';

// PrismaService abre o pool do banco ao ser importado; os testes usam mocks
vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

const listQuery = (query: Partial<ListQueryDto> = {}) =>
  ({ page: 1, limit: 10, ...query }) as ListQueryDto;

/** Texto da consulta crua (template do $queryRaw), sem as quebras de linha. */
const sqlOf = (call: unknown[]) =>
  (call[0] as string[]).join('?').replace(/\s+/g, ' ').trim();

describe('StockService', () => {
  let prisma: any;
  let service: StockService;

  beforeEach(() => {
    prisma = {
      item: {
        findFirst: vi.fn().mockResolvedValue({ id: 'item-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        create: vi
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'movement-1', ...data }),
          ),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      $queryRaw: vi
        .fn()
        .mockResolvedValue([{ id: 'item-1', type: 'product', stock: 5 }]),
      $transaction: vi.fn().mockImplementation((work) => work(prisma)),
    };

    service = new StockService(prisma);
  });

  describe('createMovement', () => {
    it('adds the units of an entry to the stock, with the author', async () => {
      const movement = await service.createMovement(
        'item-1',
        'org-1',
        'user-1',
        { type: 'ENTRY', quantity: 3, notes: 'NF 123' },
      );

      expect(prisma.item.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: { stock: 8 },
      });
      expect(prisma.stockMovement.create.mock.calls[0][0].data).toEqual({
        itemId: 'item-1',
        type: 'ENTRY',
        quantity: 3,
        balance: 8,
        notes: 'NF 123',
        createdById: 'user-1',
      });
      expect(movement).toMatchObject({ quantity: 3, balance: 8 });
    });

    it('locks the item of the organization before reading its stock', async () => {
      await service.createMovement('item-1', 'org-1', 'user-1', {
        type: 'RETURN',
        quantity: 1,
      });

      const [call] = prisma.$queryRaw.mock.calls;

      expect(sqlOf(call)).toContain('FOR UPDATE');
      expect(call.slice(1)).toEqual([
        'org-1',
        expect.objectContaining({ values: ['item-1'] }),
      ]);
      expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.item.update.mock.invocationCallOrder[0],
      );
    });

    it('turns an adjustment into the difference to the counted stock', async () => {
      await service.createMovement('item-1', 'org-1', 'user-1', {
        type: 'ADJUSTMENT',
        balance: 2,
        notes: 'Inventário',
      });

      expect(prisma.item.update.mock.calls[0][0].data).toEqual({ stock: 2 });
      expect(prisma.stockMovement.create.mock.calls[0][0].data).toMatchObject({
        type: 'ADJUSTMENT',
        quantity: -3,
        balance: 2,
      });
    });

    it('brings a negative stock back with an adjustment', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { id: 'item-1', type: 'product', stock: -2 },
      ]);

      await service.createMovement('item-1', 'org-1', 'user-1', {
        type: 'ADJUSTMENT',
        balance: 0,
        notes: 'Vendido sem estoque',
      });

      expect(prisma.stockMovement.create.mock.calls[0][0].data).toMatchObject({
        quantity: 2,
        balance: 0,
      });
    });

    it('rejects an adjustment to the current stock', async () => {
      await expect(
        service.createMovement('item-1', 'org-1', 'user-1', {
          type: 'ADJUSTMENT',
          balance: 5,
          notes: 'Contagem',
        }),
      ).rejects.toThrow('O saldo contado é o mesmo do estoque (5)');
      expect(prisma.item.update).not.toHaveBeenCalled();
    });

    it('rejects an item of another organization and a service', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      await expect(
        service.createMovement('item-1', 'org-2', 'user-1', {
          type: 'ENTRY',
          quantity: 1,
        }),
      ).rejects.toThrow(NotFoundException);

      prisma.$queryRaw.mockResolvedValueOnce([
        { id: 'item-1', type: 'service', stock: 0 },
      ]);

      await expect(
        service.createMovement('item-1', 'org-1', 'user-1', {
          type: 'ENTRY',
          quantity: 1,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    });
  });

  describe('recordSale', () => {
    it('records one sale per product with the sum of its lines', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { id: 'item-a', type: 'product', stock: 10 },
        { id: 'item-b', type: 'product', stock: 1 },
      ]);

      await service.recordSale(prisma, {
        organizationId: 'org-1',
        invoiceId: 'inv-1',
        userId: 'user-1',
        lines: [
          { id: 'item-b', quantity: 3 },
          { id: 'item-a', quantity: 2 },
          { id: 'item-a', quantity: 1 },
        ],
      });

      expect(prisma.item.update.mock.calls).toEqual([
        [{ where: { id: 'item-a' }, data: { stock: 7 } }],
        // Vende mais do que havia: o saldo fica negativo
        [{ where: { id: 'item-b' }, data: { stock: -2 } }],
      ]);
      expect(prisma.stockMovement.createMany).toHaveBeenCalledWith({
        data: [
          {
            itemId: 'item-a',
            type: 'SALE',
            quantity: -3,
            balance: 7,
            invoiceId: 'inv-1',
            createdById: 'user-1',
          },
          {
            itemId: 'item-b',
            type: 'SALE',
            quantity: -3,
            balance: -2,
            invoiceId: 'inv-1',
            createdById: 'user-1',
          },
        ],
      });
    });

    it('locks the items of the organization in the order of their ids', async () => {
      await service.recordSale(prisma, {
        organizationId: 'org-1',
        invoiceId: 'inv-1',
        userId: 'user-1',
        lines: [{ id: 'item-1', quantity: 1 }],
      });

      const sql = sqlOf(prisma.$queryRaw.mock.calls[0]);

      expect(sql).toContain('"organizationId" = ?');
      expect(sql).toContain('ORDER BY "id" FOR UPDATE');
    });

    it('leaves services and items that are not of the organization out', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { id: 'service-1', type: 'service', stock: 0 },
      ]);

      await service.recordSale(prisma, {
        organizationId: 'org-1',
        invoiceId: 'inv-1',
        userId: 'user-1',
        lines: [
          { id: 'service-1', quantity: 1 },
          { id: 'item-of-org-2', quantity: 1 },
        ],
      });

      expect(prisma.item.update).not.toHaveBeenCalled();
      expect(prisma.stockMovement.createMany).not.toHaveBeenCalled();
    });

    it('does not query without lines', async () => {
      await service.recordSale(prisma, {
        organizationId: 'org-1',
        invoiceId: 'inv-1',
        userId: 'user-1',
        lines: [],
      });

      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  it('gives the sold units back and removes the sales of an invoice not issued', async () => {
    prisma.stockMovement.findMany.mockResolvedValue([
      { itemId: 'item-a', quantity: -3 },
    ]);

    await service.undoSale(prisma, 'inv-1');

    expect(prisma.item.update).toHaveBeenCalledWith({
      where: { id: 'item-a' },
      data: { stock: { increment: 3 } },
    });
    expect(prisma.stockMovement.deleteMany).toHaveBeenCalledWith({
      where: { invoiceId: 'inv-1', type: 'SALE' },
    });
  });

  it('records the stock of the registration as the first entry', async () => {
    await service.recordInitialStock(prisma, 'item-1', 4, 'user-1');

    expect(prisma.stockMovement.create).toHaveBeenCalledWith({
      data: {
        itemId: 'item-1',
        type: 'ENTRY',
        quantity: 4,
        balance: 4,
        notes: 'Saldo inicial do cadastro',
        createdById: 'user-1',
      },
    });
  });

  describe('findMovements', () => {
    it('lists the movements of the item, the latest first', async () => {
      prisma.stockMovement.count.mockResolvedValue(11);

      const result = await service.findMovements(
        'item-1',
        'org-1',
        listQuery({ page: 2 }),
      );

      expect(prisma.item.findFirst).toHaveBeenCalledWith({
        where: { id: 'item-1', organizationId: 'org-1' },
        select: { id: true },
      });
      expect(prisma.stockMovement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { itemId: 'item-1' },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: 10,
          take: 10,
        }),
      );
      expect(result.meta).toMatchObject({ total_items: 11, total_pages: 2 });
    });

    it('does not list the movements of an item of another organization', async () => {
      prisma.item.findFirst.mockResolvedValue(null);

      await expect(
        service.findMovements('item-1', 'org-2', listQuery()),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.stockMovement.findMany).not.toHaveBeenCalled();
    });
  });
});
