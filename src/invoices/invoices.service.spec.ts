import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InvoicesService } from './invoices.service.js';
import { CreateInvoiceDto } from './dto/create-invoice.dto.js';

// PrismaService abre o pool do banco ao ser importado; os testes usam mocks
vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

function buildDto(overrides: Partial<CreateInvoiceDto> = {}): CreateInvoiceDto {
  return {
    client: { id: 'client-1', name: 'Cliente' },
    items: [
      {
        item: {
          id: 'item-1',
          name: 'Produto teste',
          type: 'product',
          price: 100,
        },
        quantity: 1,
        total: 100,
      },
    ],
    billing: {
      dueDate: '2026-10-31',
      referenceDate: '2026-10-31',
      description: 'Descricao teste',
    },
    paymentMethods: ['BANK_SLIP', 'PIX'],
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
    ...overrides,
  } as CreateInvoiceDto;
}

describe('InvoicesService', () => {
  let prisma: any;
  let asaasService: any;
  let service: InvoicesService;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));

    prisma = {
      client: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'client-1',
          organizationId: 'org-1',
          metadata: { asaas: { id: 'cus_123' } },
        }),
      },
      paymentGatewayAccount: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'gateway-1',
          metadata: { apiKey: 'encrypted' },
        }),
      },
      invoice: {
        create: vi
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'inv-1', ...data }),
          ),
        update: vi
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'inv-1', ...data }),
          ),
        delete: vi.fn().mockResolvedValue({ id: 'inv-1' }),
        findMany: vi.fn().mockResolvedValue([{ id: 'inv-1' }]),
        count: vi.fn().mockResolvedValue(1),
      },
    };

    asaasService = {
      decryptApiKey: vi.fn().mockReturnValue('api-key'),
      createPayment: vi.fn().mockResolvedValue({
        id: 'pay_123',
        invoiceUrl: 'https://asaas/i/pay_123',
        bankSlipUrl: 'https://asaas/b/pay_123',
      }),
    };

    service = new InvoicesService(prisma, asaasService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists the invoice and generates only the bank slip', async () => {
    const invoice: any = await service.create('org-1', buildDto());

    expect(prisma.invoice.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        clientId: 'client-1',
        totalValue: 99,
        status: 'PENDING',
        description: 'Descricao teste',
        paymentMethods: { BANK_SLIP: null, PIX: null },
        paymentGatewayAccountId: 'gateway-1',
        items: [
          {
            id: 'item-1',
            name: 'Produto teste',
            type: 'product',
            price: 100,
            quantity: 1,
            total: 100,
          },
        ],
      }),
    });

    expect(asaasService.createPayment).toHaveBeenCalledTimes(1);
    expect(asaasService.createPayment).toHaveBeenCalledWith('api-key', {
      customer: 'cus_123',
      billingType: 'BOLETO',
      value: 99,
      dueDate: '2026-10-31',
      description: 'Descricao teste',
      externalReference: 'inv-1',
      discount: { type: 'FIXED', value: 0.99, dueDateLimitDays: 1 },
      fine: { type: 'FIXED', value: 0.99 },
      interest: { value: 1 },
    });

    expect(invoice.paymentMethods.PIX).toBeNull();
    expect(invoice.paymentMethods.BANK_SLIP).toMatchObject({
      gatewayProvider: 'ASAAS',
      gatewayId: 'pay_123',
      bankSlipUrl: 'https://asaas/b/pay_123',
    });
    expect(invoice.gatewayIds).toEqual(['pay_123']);
  });

  it('does not create any charge when the bank slip is not enabled', async () => {
    const dto = buildDto({
      paymentMethods: ['PIX', 'CREDIT_CARD'],
      discount: { items: [], methods: [] },
    });

    const invoice: any = await service.create('org-1', dto);

    expect(asaasService.createPayment).not.toHaveBeenCalled();
    expect(invoice.paymentMethods).toEqual({ PIX: null, CREDIT_CARD: null });
  });

  it('removes the invoice when the bank slip cannot be generated', async () => {
    asaasService.createPayment.mockRejectedValue(
      new Error('Asaas API error: 400'),
    );

    await expect(service.create('org-1', buildDto())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.invoice.delete).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
    });
  });

  it('rejects business rule violations before touching the database or the gateway', async () => {
    const dto = buildDto();
    dto.discount!.methods[1].method = 'BANK_SLIP';

    await expect(service.create('org-1', dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.client.findFirst).not.toHaveBeenCalled();
    expect(prisma.invoice.create).not.toHaveBeenCalled();
    expect(asaasService.createPayment).not.toHaveBeenCalled();
  });

  it('requires a client of the organization', async () => {
    prisma.client.findFirst.mockResolvedValue(null);

    await expect(service.create('org-1', buildDto())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.client.findFirst).toHaveBeenCalledWith({
      where: { id: 'client-1', organizationId: 'org-1' },
    });
  });

  it('requires the client to be synced with Asaas', async () => {
    prisma.client.findFirst.mockResolvedValue({ id: 'client-1', metadata: {} });

    await expect(service.create('org-1', buildDto())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.invoice.create).not.toHaveBeenCalled();
  });

  it('lists invoices of the organization without provider data', async () => {
    const result = await service.findAll('org-1', 1, 10);

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1' },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 10,
      }),
    );
    expect(prisma.invoice.findMany.mock.calls[0][0].select).not.toHaveProperty(
      'meta',
    );
    expect(result.meta).toMatchObject({ total_items: 1, total_pages: 1 });
  });
});
