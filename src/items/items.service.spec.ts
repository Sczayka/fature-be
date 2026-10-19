import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ItemsService } from './items.service.js';
import type { CreateItemDto } from './dto/create-item.dto.js';
import type { ListItemsQueryDto } from './dto/list-items-query.dto.js';

// PrismaService abre o pool do banco ao ser importado; os testes usam mocks
vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

const supplierRow = (supplierId: string, name: string, isMain = false) => ({
  supplierId,
  supplierCode: `${supplierId}-code`,
  purchasePrice: 10,
  isMain,
  supplier: { name, active: true },
});

const product: CreateItemDto = {
  name: 'Teclado',
  type: 'product',
  price: 249.899,
  stock: 3,
  description: '',
  brandId: 'brand-1',
  suppliers: [
    {
      supplierId: 'supplier-1',
      supplierCode: 'TEC-01',
      purchasePrice: 150.556,
      isMain: true,
    },
    { supplierId: 'supplier-2' },
  ],
};

const listQuery = (query: Partial<ListItemsQueryDto> = {}) =>
  ({ page: 1, limit: 10, ...query }) as ListItemsQueryDto;

describe('ItemsService', () => {
  let prisma: any;
  let service: ItemsService;

  beforeEach(() => {
    const savedItem = ({ data }: any) =>
      Promise.resolve({
        id: 'item-1',
        ...data,
        brand: data.brandId
          ? { id: data.brandId, name: 'Marca', active: true }
          : null,
        suppliers: [supplierRow('supplier-1', 'Fornecedor A', true)],
      });

    prisma = {
      item: {
        create: vi.fn().mockImplementation(savedItem),
        update: vi.fn().mockImplementation(savedItem),
        findFirst: vi.fn().mockResolvedValue({
          type: 'product',
          brandId: 'brand-1',
          suppliers: [{ supplierId: 'supplier-1' }],
        }),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        delete: vi.fn().mockResolvedValue({ id: 'item-1' }),
      },
      brand: {
        findFirst: vi.fn().mockResolvedValue({ name: 'Marca', active: true }),
      },
      supplier: {
        findMany: vi
          .fn()
          .mockImplementation(({ where }) =>
            Promise.resolve(
              where.id.in.map((id: string) => ({ id, name: id, active: true })),
            ),
          ),
      },
      itemSupplier: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      $transaction: vi.fn().mockImplementation((work) => work(prisma)),
    };

    service = new ItemsService(prisma);
  });

  describe('create', () => {
    it('stores the brand and the suppliers checked against the organization', async () => {
      const result = await service.create('org-1', product);

      expect(prisma.brand.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'brand-1', organizationId: 'org-1' },
        }),
      );
      expect(prisma.supplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: { in: ['supplier-1', 'supplier-2'] },
            organizationId: 'org-1',
          },
        }),
      );
      expect(prisma.item.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            name: 'Teclado',
            type: 'product',
            price: 249.9,
            stock: 3,
            description: '',
            brandId: 'brand-1',
            organizationId: 'org-1',
            suppliers: {
              create: [
                {
                  supplierId: 'supplier-1',
                  supplierCode: 'TEC-01',
                  purchasePrice: 150.56,
                  isMain: true,
                },
                {
                  supplierId: 'supplier-2',
                  supplierCode: null,
                  purchasePrice: null,
                  isMain: false,
                },
              ],
            },
          },
        }),
      );
      expect(result.suppliers).toEqual([
        {
          supplierId: 'supplier-1',
          name: 'Fornecedor A',
          active: true,
          supplierCode: 'supplier-1-code',
          purchasePrice: 10,
          isMain: true,
        },
      ]);
    });

    it('rejects a brand for a service', async () => {
      await expect(
        service.create('org-1', { ...product, type: 'service' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.item.create).not.toHaveBeenCalled();
    });

    it('rejects a brand of another organization', async () => {
      prisma.brand.findFirst.mockResolvedValue(null);

      await expect(service.create('org-1', product)).rejects.toThrow(
        new NotFoundException('Marca não encontrada'),
      );
      expect(prisma.item.create).not.toHaveBeenCalled();
    });

    it('rejects an inactive brand', async () => {
      prisma.brand.findFirst.mockResolvedValue({
        name: 'Antiga',
        active: false,
      });

      await expect(service.create('org-1', product)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a supplier of another organization', async () => {
      prisma.supplier.findMany.mockResolvedValue([
        { id: 'supplier-1', name: 'A', active: true },
      ]);

      await expect(service.create('org-1', product)).rejects.toThrow(
        new NotFoundException('Fornecedor não encontrado'),
      );
      expect(prisma.item.create).not.toHaveBeenCalled();
    });

    it('rejects repeated suppliers and more than one main supplier', async () => {
      await expect(
        service.create('org-1', {
          ...product,
          suppliers: [
            { supplierId: 'supplier-1' },
            { supplierId: 'supplier-1' },
          ],
        }),
      ).rejects.toThrow('O mesmo fornecedor aparece mais de uma vez no item');
      await expect(
        service.create('org-1', {
          ...product,
          suppliers: [
            { supplierId: 'supplier-1', isMain: true },
            { supplierId: 'supplier-2', isMain: true },
          ],
        }),
      ).rejects.toThrow('Marque no máximo um fornecedor principal');
      expect(prisma.supplier.findMany).not.toHaveBeenCalled();
    });

    it('creates an item without brand and suppliers', async () => {
      await service.create('org-1', {
        name: 'Instalação',
        type: 'service',
        price: 80,
        stock: 0,
        description: '',
      });

      expect(prisma.brand.findFirst).not.toHaveBeenCalled();
      expect(prisma.supplier.findMany).not.toHaveBeenCalled();
      expect(prisma.item.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            brandId: null,
            suppliers: { create: [] },
          }),
        }),
      );
    });
  });

  describe('update', () => {
    it('changes only the fields that were sent', async () => {
      await service.update('item-1', 'org-1', { price: 10.006 });

      const { data } = prisma.item.update.mock.calls[0][0];

      expect(data).toEqual({
        name: undefined,
        type: undefined,
        price: 10.01,
        stock: undefined,
        description: undefined,
        brandId: undefined,
        suppliers: undefined,
      });
      expect(prisma.itemSupplier.deleteMany).not.toHaveBeenCalled();
      expect(prisma.brand.findFirst).not.toHaveBeenCalled();
    });

    it('scopes the item to the organization', async () => {
      prisma.item.findFirst.mockResolvedValue(null);

      await expect(
        service.update('item-1', 'org-2', { name: 'Outro' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.item.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'item-1', organizationId: 'org-2' },
        }),
      );
      expect(prisma.item.update).not.toHaveBeenCalled();
    });

    it('removes the brand with null and replaces the suppliers', async () => {
      await service.update('item-1', 'org-1', {
        brandId: null,
        suppliers: [{ supplierId: 'supplier-3', purchasePrice: 5 }],
      });

      expect(prisma.itemSupplier.deleteMany).toHaveBeenCalledWith({
        where: { itemId: 'item-1' },
      });
      expect(prisma.item.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            brandId: null,
            suppliers: {
              create: [
                {
                  supplierId: 'supplier-3',
                  supplierCode: null,
                  purchasePrice: 5,
                  isMain: false,
                },
              ],
            },
          }),
        }),
      );
    });

    it('clears all suppliers with an empty list', async () => {
      await service.update('item-1', 'org-1', { suppliers: [] });

      expect(prisma.supplier.findMany).not.toHaveBeenCalled();
      expect(prisma.itemSupplier.deleteMany).toHaveBeenCalled();
      expect(prisma.item.update.mock.calls[0][0].data.suppliers).toEqual({
        create: [],
      });
    });

    it('removes the brand when the product becomes a service', async () => {
      await service.update('item-1', 'org-1', { type: 'service' });

      expect(prisma.item.update.mock.calls[0][0].data).toMatchObject({
        type: 'service',
        brandId: null,
      });
    });

    it('rejects a brand for a service, also when only the brand is sent', async () => {
      prisma.item.findFirst.mockResolvedValue({
        type: 'service',
        brandId: null,
        suppliers: [],
      });

      await expect(
        service.update('item-1', 'org-1', { brandId: 'brand-2' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.item.update).not.toHaveBeenCalled();
    });

    it('keeps an inactive brand or supplier the item already had', async () => {
      prisma.brand.findFirst.mockResolvedValue({
        name: 'Antiga',
        active: false,
      });
      prisma.supplier.findMany.mockResolvedValue([
        { id: 'supplier-1', name: 'Antigo', active: false },
      ]);

      await expect(
        service.update('item-1', 'org-1', {
          brandId: 'brand-1',
          suppliers: [{ supplierId: 'supplier-1' }],
        }),
      ).resolves.toBeDefined();
      // Mesma marca: não é conferida de novo
      expect(prisma.brand.findFirst).not.toHaveBeenCalled();
    });

    it('rejects an inactive supplier the item did not have', async () => {
      prisma.supplier.findMany.mockResolvedValue([
        { id: 'supplier-9', name: 'Inativo', active: false },
      ]);

      await expect(
        service.update('item-1', 'org-1', {
          suppliers: [{ supplierId: 'supplier-9' }],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.itemSupplier.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('filters by brand and returns the brand of each item', async () => {
      prisma.item.findMany.mockResolvedValue([
        {
          id: 'item-1',
          name: 'Teclado',
          brand: { id: 'brand-1', name: 'Marca', active: true },
        },
      ]);
      prisma.item.count.mockResolvedValue(1);

      const result = await service.findAll(
        'org-1',
        listQuery({ brandId: 'brand-1' }),
      );

      // Sem fornecedor no filtro, a lista não traz os vínculos
      expect(prisma.item.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', brandId: 'brand-1' },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 10,
        include: { brand: { select: { id: true, name: true, active: true } } },
      });
      expect(result.data).toEqual([
        {
          id: 'item-1',
          name: 'Teclado',
          brand: { id: 'brand-1', name: 'Marca', active: true },
        },
      ]);
      expect(result.meta).toMatchObject({ total_items: 1, total_pages: 1 });
    });

    it('with a supplier, lists its items with only the link to it', async () => {
      prisma.item.findMany.mockResolvedValue([
        {
          id: 'item-1',
          brand: null,
          suppliers: [supplierRow('supplier-1', 'Fornecedor A')],
        },
      ]);

      const result = await service.findAll(
        'org-1',
        listQuery({ supplierId: 'supplier-1' }),
      );
      const [args] = prisma.item.findMany.mock.calls[0];

      expect(args.where).toEqual({
        organizationId: 'org-1',
        suppliers: { some: { supplierId: 'supplier-1' } },
      });
      expect(args.include.suppliers.where).toEqual({
        supplierId: 'supplier-1',
      });
      expect(result.data[0]).toEqual({
        id: 'item-1',
        brand: null,
        suppliers: [
          {
            supplierId: 'supplier-1',
            name: 'Fornecedor A',
            active: true,
            supplierCode: 'supplier-1-code',
            purchasePrice: 10,
            isMain: false,
          },
        ],
      });
    });

    it('applies the name, type, price and creation filters', async () => {
      await service.findAll(
        'org-1',
        listQuery({
          page: 2,
          limit: 20,
          name: 'tec',
          type: 'product',
          price: 249.9,
          createdAt: '2026-10-18',
        }),
      );

      expect(prisma.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: 'org-1',
            name: { contains: 'tec', mode: 'insensitive' },
            type: 'product',
            price: 249.9,
            createdAt: {
              gte: new Date('2026-10-18T00:00:00.000Z'),
              lte: new Date('2026-10-18T23:59:59.999Z'),
            },
          },
          skip: 20,
          take: 20,
        }),
      );
    });
  });

  it('returns the brand and the suppliers in the detail', async () => {
    prisma.item.findFirst.mockResolvedValue({
      id: 'item-1',
      brand: { id: 'brand-1', name: 'Marca', active: false },
      suppliers: [supplierRow('supplier-1', 'Fornecedor A', true)],
    });

    await expect(service.findOne('item-1', 'org-1')).resolves.toEqual({
      id: 'item-1',
      brand: { id: 'brand-1', name: 'Marca', active: false },
      suppliers: [
        {
          supplierId: 'supplier-1',
          name: 'Fornecedor A',
          active: true,
          supplierCode: 'supplier-1-code',
          purchasePrice: 10,
          isMain: true,
        },
      ],
    });
  });
});
