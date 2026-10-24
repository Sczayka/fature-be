import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { InvoiceDraftsService } from './invoice-drafts.service.js';
import { CreateInvoiceDraftDto } from './dto/create-invoice-draft.dto.js';
import { UpdateInvoiceDraftDto } from './dto/update-invoice-draft.dto.js';

// PrismaService abre o pool do banco ao ser importado; os testes usam mocks
vi.mock('../../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
vi.mock('../invoices.service.js', () => ({ InvoicesService: class {} }));

describe('InvoiceDraftsService', () => {
  let prisma: any;
  let invoicesService: any;
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
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    invoicesService = {
      create: vi.fn().mockResolvedValue({ id: 'invoice-1' }),
    };

    service = new InvoiceDraftsService(prisma, invoicesService);
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

  it('lists the open drafts of the organization with the pagination meta', async () => {
    const result = await service.findAll('org-1', { page: 2, limit: 10 });

    // Os convertidos em cobrança saem da lista
    expect(prisma.invoiceDraft.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', convertedAt: null },
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

  it('filters the drafts of a registered client by the id in the client JSON', async () => {
    await service.findAll('org-1', {
      page: 1,
      limit: 10,
      clientId: 'client-1',
      createdAt: '2026-10-01',
    });

    const where = {
      organizationId: 'org-1',
      convertedAt: null,
      createdAt: {
        gte: new Date('2026-10-01T00:00:00.000Z'),
        lte: new Date('2026-10-01T23:59:59.999Z'),
      },
      client: { path: ['id'], equals: 'client-1' },
    };

    expect(prisma.invoiceDraft.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where }),
    );
    expect(prisma.invoiceDraft.count).toHaveBeenCalledWith({ where });
  });

  it('scopes reads to the open drafts of the organization', async () => {
    prisma.invoiceDraft.findFirst.mockResolvedValue(null);

    await expect(service.findOne('draft-1', 'org-2')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.invoiceDraft.findFirst).toHaveBeenCalledWith({
      where: { id: 'draft-1', organizationId: 'org-2', convertedAt: null },
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

  describe('renderPdf', () => {
    const quoteDraft = {
      client: { name: 'Maria' },
      items: [
        {
          item: { id: 'item-1', name: 'Site', type: 'service', price: 1000 },
          quantity: 1,
          total: 1000,
        },
      ],
      billing: null,
      paymentMethods: [],
      discount: null,
      interestAndFine: null,
      updatedAt: new Date('2026-10-18T15:00:00Z'),
      organization: {
        name: 'Raipp',
        logo: null,
        backgroundColor: null,
        buttonColor: null,
        contactEmail: null,
        phone: null,
        mobilePhone: null,
        cnpj: null,
        logoImage: null,
      },
    };

    it('renders the PDF of a draft of the organization', async () => {
      prisma.invoiceDraft.findFirst.mockResolvedValue(quoteDraft);

      const pdf = await service.renderPdf('draft-1', 'org-1');

      expect(prisma.invoiceDraft.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'draft-1', organizationId: 'org-1', convertedAt: null },
        }),
      );
      expect(pdf.filename).toBe('orcamento-maria.pdf');
      expect(pdf.content.subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('refuses a draft without items', async () => {
      prisma.invoiceDraft.findFirst.mockResolvedValue({
        ...quoteDraft,
        items: [],
      });

      await expect(service.renderPdf('draft-1', 'org-1')).rejects.toThrow(
        'Adicione itens ao orçamento antes de gerar o PDF.',
      );
    });

    it('does not render drafts of another organization', async () => {
      prisma.invoiceDraft.findFirst.mockResolvedValue(null);

      await expect(
        service.renderPdf('draft-1', 'org-2'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('convertToInvoice', () => {
    const completeDraft = {
      id: 'draft-1',
      organizationId: 'org-1',
      client: { id: 'client-1', name: 'Cliente' },
      items: [
        {
          item: { id: 'item-1', name: 'Serviço', type: 'service', price: 100 },
          quantity: 2,
          total: 200,
        },
      ],
      billing: { dueDate: '2030-01-10', referenceDate: '', description: '' },
      paymentMethods: ['BANK_SLIP'],
      discount: null,
      interestAndFine: null,
    };

    it('issues the invoice from the saved sections and marks the draft as converted', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-24T15:00:00Z'));

      prisma.invoiceDraft.findFirst.mockResolvedValue(completeDraft);

      const result = await service.convertToInvoice(
        'draft-1',
        'org-1',
        'user-1',
      );

      expect(invoicesService.create).toHaveBeenCalledTimes(1);

      // Quem converteu é o autor da baixa no estoque
      const [orgId, dto, userId] = invoicesService.create.mock.calls[0];

      expect(orgId).toBe('org-1');
      expect(userId).toBe('user-1');
      expect(dto.client.id).toBe('client-1');
      expect(dto.items[0].quantity).toBe(2);
      expect(dto.billing.dueDate).toBe('2030-01-10');
      expect(dto.paymentMethods).toEqual(['BANK_SLIP']);
      // O orçamento fica, fora das telas, para a taxa de conversão
      expect(prisma.invoiceDraft.delete).not.toHaveBeenCalled();
      expect(prisma.invoiceDraft.updateMany).toHaveBeenCalledWith({
        where: { id: 'draft-1', convertedAt: null },
        data: {
          convertedAt: new Date('2026-10-24T15:00:00Z'),
          invoiceId: 'invoice-1',
        },
      });
      expect(result).toEqual({ id: 'invoice-1' });

      vi.useRealTimers();
    });

    it('rejects an incomplete draft without issuing or converting anything', async () => {
      prisma.invoiceDraft.findFirst.mockResolvedValue({
        ...completeDraft,
        items: [],
        billing: null,
        paymentMethods: [],
      });

      await expect(
        service.convertToInvoice('draft-1', 'org-1', 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(invoicesService.create).not.toHaveBeenCalled();
      expect(prisma.invoiceDraft.updateMany).not.toHaveBeenCalled();
    });

    it('keeps the draft when the invoice cannot be issued', async () => {
      prisma.invoiceDraft.findFirst.mockResolvedValue(completeDraft);
      invoicesService.create.mockRejectedValue(new BadRequestException('x'));

      await expect(
        service.convertToInvoice('draft-1', 'org-1', 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.invoiceDraft.updateMany).not.toHaveBeenCalled();
    });

    it('does not fail when marking the draft fails after the invoice was issued', async () => {
      prisma.invoiceDraft.findFirst.mockResolvedValue(completeDraft);
      prisma.invoiceDraft.updateMany.mockRejectedValue(new Error('db'));

      await expect(
        service.convertToInvoice('draft-1', 'org-1', 'user-1'),
      ).resolves.toEqual({ id: 'invoice-1' });
    });
  });
});
