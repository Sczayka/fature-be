import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BrandsService } from './brands.service.js';
import type { ListBrandsQueryDto } from './dto/list-brands-query.dto.js';

// PrismaService abre o pool do banco ao ser importado; os testes usam mocks
vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

const brand = {
  id: 'brand-1',
  name: 'Logitech',
  active: true,
  organizationId: 'org-1',
};

describe('BrandsService', () => {
  let prisma: any;
  let service: BrandsService;

  beforeEach(() => {
    prisma = {
      brand: {
        create: vi
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'brand-1', ...data }),
          ),
        findFirst: vi.fn().mockImplementation(({ where }) =>
          // Sem duplicado de nome; a própria marca existe
          Promise.resolve(where.id ? brand : null),
        ),
        findMany: vi.fn().mockResolvedValue([brand]),
        count: vi.fn().mockResolvedValue(1),
        update: vi
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ ...brand, ...data }),
          ),
        delete: vi.fn().mockResolvedValue(brand),
      },
      item: { count: vi.fn().mockResolvedValue(0) },
    };

    service = new BrandsService(prisma);
  });

  it('creates a brand of the organization', async () => {
    await service.create('org-1', { name: 'Logitech' });

    expect(prisma.brand.create).toHaveBeenCalledWith({
      data: { name: 'Logitech', active: undefined, organizationId: 'org-1' },
    });
  });

  it('rejects a name already used in the organization, ignoring the case', async () => {
    prisma.brand.findFirst.mockResolvedValue({ active: true });

    await expect(service.create('org-1', { name: 'LOGITECH' })).rejects.toThrow(
      new ConflictException('Já existe uma marca com este nome.'),
    );
    expect(prisma.brand.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        name: { equals: 'LOGITECH', mode: 'insensitive' },
      },
      select: { active: true },
    });
    expect(prisma.brand.create).not.toHaveBeenCalled();
  });

  it('suggests reactivating an inactive brand with the same name', async () => {
    prisma.brand.findFirst.mockResolvedValue({ active: false });

    await expect(service.create('org-1', { name: 'Logitech' })).rejects.toThrow(
      'Já existe uma marca inativa com este nome: reative-a em vez de cadastrar outra.',
    );
  });

  it('reports a conflict when the name is taken between the check and the insert', async () => {
    prisma.brand.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.10.0',
      }),
    );

    await expect(service.create('org-1', { name: 'Logitech' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('lists with the name, status and creation filters', async () => {
    const result = await service.findAll('org-1', {
      page: 2,
      limit: 10,
      name: 'logi',
      active: false,
      createdAt: '2026-10-18',
    } as ListBrandsQueryDto);

    expect(prisma.brand.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        name: { contains: 'logi', mode: 'insensitive' },
        active: false,
        createdAt: {
          gte: new Date('2026-10-18T00:00:00.000Z'),
          lte: new Date('2026-10-18T23:59:59.999Z'),
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: 10,
      take: 10,
    });
    expect(result.meta).toMatchObject({
      page: 2,
      total_items: 1,
      has_previous: true,
    });
  });

  it('searches only active brands, up to 10', async () => {
    await service.search('org-1', 'log');

    expect(prisma.brand.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        active: true,
        name: { contains: 'log', mode: 'insensitive' },
      },
      select: { id: true, name: true, active: true },
      orderBy: { name: 'asc' },
      take: 10,
    });
  });

  it('scopes the brand to the organization', async () => {
    prisma.brand.findFirst.mockResolvedValue(null);

    await expect(service.findOne('brand-1', 'org-2')).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      service.update('brand-1', 'org-2', { active: false }),
    ).rejects.toThrow(NotFoundException);
    await expect(service.remove('brand-1', 'org-2')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.brand.update).not.toHaveBeenCalled();
    expect(prisma.brand.delete).not.toHaveBeenCalled();
  });

  it('inactivates a brand without checking the name', async () => {
    await service.update('brand-1', 'org-1', { active: false });

    expect(prisma.brand.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.brand.update).toHaveBeenCalledWith({
      where: { id: 'brand-1' },
      data: { name: undefined, active: false },
    });
  });

  it('renames a brand when no other brand has the name', async () => {
    await service.update('brand-1', 'org-1', { name: 'Logi' });

    expect(prisma.brand.findFirst).toHaveBeenLastCalledWith({
      where: {
        organizationId: 'org-1',
        name: { equals: 'Logi', mode: 'insensitive' },
        NOT: { id: 'brand-1' },
      },
      select: { active: true },
    });
    expect(prisma.brand.update).toHaveBeenCalled();
  });

  it('does not delete a brand used by products and suggests inactivating it', async () => {
    prisma.item.count.mockResolvedValue(3);

    await expect(service.remove('brand-1', 'org-1')).rejects.toThrow(
      new ConflictException(
        'Esta marca está em 3 produtos e não pode ser excluída. Inative-a para que ela não apareça em novos cadastros.',
      ),
    );
    expect(prisma.item.count).toHaveBeenCalledWith({
      where: { brandId: 'brand-1' },
    });
    expect(prisma.brand.delete).not.toHaveBeenCalled();
  });

  it('deletes a brand without products', async () => {
    await service.remove('brand-1', 'org-1');

    expect(prisma.brand.delete).toHaveBeenCalledWith({
      where: { id: 'brand-1' },
    });
  });
});
