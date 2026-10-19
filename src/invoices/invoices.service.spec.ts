import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InvoicesService } from './invoices.service.js';
import { CreateInvoiceDto } from './dto/create-invoice.dto.js';
import { PaymentProviderError } from '../payments/providers/payment-provider.js';

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
  const client = {
    id: 'client-1',
    organizationId: 'org-1',
    name: 'Cliente',
  };
  const bankSlipRoute = { method: 'BANK_SLIP', provider: { code: 'ANY' } };

  let prisma: any;
  let routing: any;
  let charges: any;
  let eventEmitter: any;
  let service: InvoicesService;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
    vi.stubEnv('FRONTEND_URL', 'https://app.fature.test');

    prisma = {
      client: { findFirst: vi.fn().mockResolvedValue(client) },
      invoice: {
        create: vi
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'inv-1', ...data }),
          ),
        delete: vi.fn().mockResolvedValue({ id: 'inv-1' }),
        findFirst: vi.fn().mockResolvedValue({
          id: 'inv-1',
          status: 'PENDING',
          dueDate: new Date('2026-10-31T00:00:00Z'),
          checkoutToken: 'token-1',
        }),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
    };

    routing = {
      getRoutes: vi.fn().mockResolvedValue(
        new Map<string, unknown>([
          ['BANK_SLIP', bankSlipRoute],
          ['PIX', { method: 'PIX' }],
          ['CREDIT_CARD', { method: 'CREDIT_CARD' }],
          ['DEBIT_CARD', null],
        ]),
      ),
    };

    charges = {
      createCharge: vi.fn().mockResolvedValue({ record: { id: 'charge-1' } }),
    };

    eventEmitter = { emit: vi.fn() };

    service = new InvoicesService(prisma, routing, charges, eventEmitter);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('persists the invoice with its methods and generates only the bank slip, in the method route', async () => {
    const invoice: any = await service.create('org-1', buildDto());

    const { data } = prisma.invoice.create.mock.calls[0][0];

    expect(data).toMatchObject({
      organizationId: 'org-1',
      clientId: 'client-1',
      totalValue: 99,
      status: 'PENDING',
      description: 'Descricao teste',
      paymentMethods: ['BANK_SLIP', 'PIX'],
    });
    expect(data.checkoutToken).toMatch(/^[\w-]{32}$/);

    expect(charges.createCharge).toHaveBeenCalledTimes(1);
    expect(charges.createCharge).toHaveBeenCalledWith({
      invoiceId: 'inv-1',
      client,
      route: bankSlipRoute,
      request: {
        method: 'BANK_SLIP',
        value: 99,
        dueDate: '2026-10-31',
        description: 'Descricao teste',
        discount: { value: 0.99, until: '2026-10-30' },
        fine: 0.99,
        interestPercent: 1,
      },
      validUntil: null,
    });

    expect(invoice.checkoutUrl).toBe('https://app.fature.test/pagar/token-1');
    expect(invoice).not.toHaveProperty('checkoutToken');
  });

  it('does not create any charge when the bank slip is not enabled', async () => {
    const dto = buildDto({
      paymentMethods: ['PIX', 'CREDIT_CARD'],
      discount: { items: [], methods: [] },
    });

    await service.create('org-1', dto);

    expect(charges.createCharge).not.toHaveBeenCalled();
    expect(prisma.invoice.create.mock.calls[0][0].data.paymentMethods).toEqual([
      'PIX',
      'CREDIT_CARD',
    ]);
  });

  it('rejects methods without an available provider before creating the invoice', async () => {
    const dto = buildDto({
      paymentMethods: ['PIX', 'DEBIT_CARD'],
      discount: { items: [], methods: [] },
    });

    await expect(service.create('org-1', dto)).rejects.toThrow(
      'Forma de pagamento indisponível: Cartão de débito',
    );
    expect(prisma.invoice.create).not.toHaveBeenCalled();
  });

  it('removes the invoice when the provider refuses the bank slip data', async () => {
    charges.createCharge.mockRejectedValue(
      new PaymentProviderError('CPF inválido', 'INVALID_DATA'),
    );

    await expect(service.create('org-1', buildDto())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.invoice.delete).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
    });
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('announces the issued invoice after the bank slip is created', async () => {
    const order: string[] = [];

    charges.createCharge.mockImplementation(async () => {
      order.push('bank-slip');

      return { record: { id: 'charge-1' } };
    });
    eventEmitter.emit.mockImplementation(() => order.push('issued'));

    await service.create('org-1', buildDto());

    expect(eventEmitter.emit).toHaveBeenCalledWith('invoice.issued', {
      invoiceId: 'inv-1',
      organizationId: 'org-1',
    });
    expect(order).toEqual(['bank-slip', 'issued']);
  });

  it('reports an unavailable provider as a bad gateway', async () => {
    charges.createCharge.mockRejectedValue(
      new PaymentProviderError('Indisponível', 'UNAVAILABLE'),
    );

    await expect(service.create('org-1', buildDto())).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(prisma.invoice.delete).toHaveBeenCalled();
  });

  it('rejects business rule violations before touching the database or the gateway', async () => {
    const dto = buildDto();
    dto.discount!.methods[1].method = 'BANK_SLIP';

    await expect(service.create('org-1', dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.client.findFirst).not.toHaveBeenCalled();
    expect(prisma.invoice.create).not.toHaveBeenCalled();
    expect(charges.createCharge).not.toHaveBeenCalled();
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

  it('lists invoices with the checkout link and without provider data', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      {
        id: 'inv-1',
        status: 'PENDING',
        dueDate: new Date('2026-10-31T00:00:00Z'),
        checkoutToken: 'token-1',
      },
    ]);
    prisma.invoice.count.mockResolvedValue(1);

    const result = await service.findAll('org-1', 1, 10);
    const query = prisma.invoice.findMany.mock.calls[0][0];

    expect(query).toMatchObject({
      where: { organizationId: 'org-1' },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 10,
    });
    expect(query.select).not.toHaveProperty('meta');
    expect(query.select).not.toHaveProperty('gatewayIds');
    expect(query.select).not.toHaveProperty('legacyPaymentMethods');
    expect(result.data[0]).toEqual({
      id: 'inv-1',
      status: 'PENDING',
      dueDate: new Date('2026-10-31T00:00:00Z'),
      checkoutUrl: 'https://app.fature.test/pagar/token-1',
    });
    expect(result.meta).toMatchObject({ total_items: 1, total_pages: 1 });
  });

  it('shows a pending invoice past its due date as overdue', async () => {
    prisma.invoice.findFirst.mockResolvedValue({
      id: 'inv-1',
      status: 'PENDING',
      dueDate: new Date('2026-10-10T00:00:00Z'),
      checkoutToken: 'token-1',
    });

    await expect(service.findOne('inv-1', 'org-1')).resolves.toMatchObject({
      status: 'OVERDUE',
    });
  });

  it('returns the charges of the invoice without the provider routing', async () => {
    await service.findOne('inv-1', 'org-1');

    const query = prisma.invoice.findFirst.mock.calls[0][0];
    const chargeFields = Object.keys(query.select.charges.select);

    expect(query.where).toEqual({ id: 'inv-1', organizationId: 'org-1' });
    expect(chargeFields).not.toContain('paymentGatewayAccountId');
    expect(chargeFields).not.toContain('externalId');
    expect(chargeFields).not.toContain('providerResponse');
    expect(chargeFields).not.toContain('costAmount');
  });

  it('does not return invoices of another organization', async () => {
    prisma.invoice.findFirst.mockResolvedValue(null);

    await expect(service.findOne('inv-1', 'org-2')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
