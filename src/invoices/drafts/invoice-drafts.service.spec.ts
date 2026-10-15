import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { InvoiceDraftsService } from './invoice-drafts.service.js';
import { CreateInvoiceDraftDto } from './dto/create-invoice-draft.dto.js';
import { UpdateInvoiceDraftDto } from './dto/update-invoice-draft.dto.js';

// PrismaService abre o pool do banco ao ser importado; os testes usam mocks
vi.mock('../../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

describe('InvoiceDraftsService', () => {
  let prisma: any;
  let service: InvoiceDraftsService;

  beforeEach(() => {
    prisma = {
      invoiceDraft: {
        create: vi
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'draft-1', ...data }),
          ),
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'draft-1', organizationId: 'org-1' }),
        findMany: vi.fn().mockResolvedValue([{ id: 'draft-1' }]),
        count: vi.fn().mockResolvedValue(11),
        update: vi
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'draft-1', ...data }),
          ),
        delete: vi.fn().mockResolvedValue({ id: 'draft-1' }),
      },
    };

    service = new InvoiceDraftsService(prisma);
  });

  it('stores partial data without billing rules', async () => {
    const dto = plainToInstance(CreateInvoiceDraftDto, {
      client: { id: '', name: 'Prospect' },
      billing: { dueDate: '', referenceDate: '', description: '' },
    });

    await service.create('org-1', dto);

    expect(prisma.invoiceDraft.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        client: { id: '', name: 'Prospect' },
        billing: { dueDate: '', referenceDate: '', description: '' },
      },
    });
  });

  it('lists drafts of the organization with the pagination meta', async () => {
    const result = await service.findAll('org-1', 2, 10);

    expect(prisma.invoiceDraft.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      orderBy: { createdAt: 'desc' },
      skip: 10,
      take: 10,
    });
    expect(result.meta).toEqual({
      page: 2,
      per_page: 10,
      total_items: 11,
      total_pages: 2,
      has_next: false,
      has_previous: true,
    });
  });

  it('scopes reads to the organization', async () => {
    prisma.invoiceDraft.findFirst.mockResolvedValue(null);

    await expect(service.findOne('draft-1', 'org-2')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.invoiceDraft.findFirst).toHaveBeenCalledWith({
      where: { id: 'draft-1', organizationId: 'org-2' },
    });
  });

  it('updates only the sections that were sent and clears sections sent as null', async () => {
    const dto = plainToInstance(UpdateInvoiceDraftDto, {
      paymentMethods: ['PIX'],
      discount: null,
    });

    await service.update('draft-1', 'org-1', dto);

    expect(prisma.invoiceDraft.update).toHaveBeenCalledWith({
      where: { id: 'draft-1' },
      data: { paymentMethods: ['PIX'], discount: Prisma.DbNull },
    });
  });

  it('does not update or delete drafts of another organization', async () => {
    prisma.invoiceDraft.findFirst.mockResolvedValue(null);

    await expect(service.update('draft-1', 'org-2', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.remove('draft-1', 'org-2')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.invoiceDraft.update).not.toHaveBeenCalled();
    expect(prisma.invoiceDraft.delete).not.toHaveBeenCalled();
  });

  it('deletes a draft of the organization', async () => {
    await service.remove('draft-1', 'org-1');

    expect(prisma.invoiceDraft.delete).toHaveBeenCalledWith({
      where: { id: 'draft-1' },
    });
  });
});
