import { ConflictException } from '@nestjs/common';
import { FinancialCategoriesService } from './financial-categories.service.js';

vi.mock('../../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

function category(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cat-rent',
    name: 'Aluguel',
    direction: 'OUT',
    active: true,
    createdAt: new Date('2026-10-01T12:00:00Z'),
    updatedAt: new Date('2026-10-01T12:00:00Z'),
    _count: { entries: 0 },
    ...overrides,
  };
}

describe('FinancialCategoriesService', () => {
  let prisma: any;
  let setup: any;
  let service: FinancialCategoriesService;

  beforeEach(() => {
    prisma = {
      financialCategory: {
        findMany: vi.fn().mockResolvedValue([category()]),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(category()),
        update: vi.fn().mockResolvedValue(category()),
        delete: vi.fn().mockResolvedValue(category()),
      },
    };
    setup = { ensureSetup: vi.fn().mockResolvedValue(undefined) };
    service = new FinancialCategoriesService(prisma, setup);
  });

  it('lists with the default categories in place and the number of entries', async () => {
    const [result] = await service.findAll('org-1', { direction: 'OUT' });

    expect(setup.ensureSetup).toHaveBeenCalledWith('org-1');
    expect(prisma.financialCategory.findMany.mock.calls[0][0].where).toEqual({
      organizationId: 'org-1',
      direction: 'OUT',
    });
    expect(result).toMatchObject({ name: 'Aluguel', entryCount: 0 });
    expect(result).not.toHaveProperty('_count');
  });

  it('rejects a name already used in the same direction, ignoring case', async () => {
    prisma.financialCategory.findFirst.mockResolvedValue({ id: 'cat-other' });

    await expect(
      service.create('org-1', { name: 'aluguel', direction: 'OUT' }),
    ).rejects.toThrow(
      new ConflictException(
        'Já existe uma categoria de despesa com este nome.',
      ),
    );
    expect(prisma.financialCategory.findFirst.mock.calls[0][0].where).toEqual({
      organizationId: 'org-1',
      direction: 'OUT',
      name: { equals: 'aluguel', mode: 'insensitive' },
    });
  });

  it('does not delete a category in use and suggests inactivating it', async () => {
    prisma.financialCategory.findFirst.mockResolvedValue(
      category({ _count: { entries: 4 } }),
    );

    await expect(service.remove('cat-rent', 'org-1')).rejects.toThrow(
      'Esta categoria está em 4 lançamentos e não pode ser excluída. Inative-a para que ela não apareça em novos lançamentos.',
    );
    expect(prisma.financialCategory.delete).not.toHaveBeenCalled();
  });

  it('deletes a category without entries', async () => {
    prisma.financialCategory.findFirst.mockResolvedValue(category());

    await service.remove('cat-rent', 'org-1');

    expect(prisma.financialCategory.delete).toHaveBeenCalledWith({
      where: { id: 'cat-rent' },
    });
  });
});
