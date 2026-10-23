import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

/** Fatura como lida pelo detalhe (GET /invoices/:id). */
function storedInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    status: 'PENDING',
    items: [{ id: 'item-1', total: 100 }],
    dueDate: new Date('2026-10-31T00:00:00Z'),
    discount: null,
    interestAndFine: null,
    checkoutToken: 'token-1',
    paymentMethods: ['BANK_SLIP', 'PIX'],
    transactions: [],
    organization: {
      bankTransferEnabled: false,
      pixMode: 'AUTOMATIC',
      bankAccount: null,
    },
    ...overrides,
  };
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
  let paymentMethods: any;
  let charges: any;
  let eventEmitter: any;
  let stock: any;
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
        findFirst: vi.fn().mockResolvedValue(storedInvoice()),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      $transaction: vi.fn().mockImplementation((work) => work(prisma)),
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

    paymentMethods = {
      availability: vi.fn().mockResolvedValue(
        new Map([
          ['BANK_SLIP', true],
          ['PIX', true],
          ['CREDIT_CARD', true],
          ['DEBIT_CARD', false],
          ['BANK_TRANSFER', false],
        ]),
      ),
    };

    charges = {
      createCharge: vi.fn().mockResolvedValue({ record: { id: 'charge-1' } }),
    };

    eventEmitter = { emit: vi.fn() };

    stock = {
      recordSale: vi.fn().mockResolvedValue(undefined),
      undoSale: vi.fn().mockResolvedValue(undefined),
    };

    service = new InvoicesService(
      prisma,
      routing,
      paymentMethods,
      charges,
      eventEmitter,
      stock,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('persists the invoice with its methods and generates only the bank slip, in the method route', async () => {
    const invoice: any = await service.create('org-1', buildDto(), 'user-1');

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

    await service.create('org-1', dto, 'user-1');

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

    await expect(service.create('org-1', dto, 'user-1')).rejects.toThrow(
      'Forma de pagamento indisponível: Cartão de débito',
    );
    expect(prisma.invoice.create).not.toHaveBeenCalled();
  });

  it('accepts the bank transfer once it is released for the organization', async () => {
    const dto = buildDto({
      paymentMethods: ['BANK_TRANSFER'],
      discount: { items: [], methods: [] },
    });

    await expect(service.create('org-1', dto, 'user-1')).rejects.toThrow(
      'Forma de pagamento indisponível: Transferência bancária',
    );

    paymentMethods.availability.mockResolvedValue(
      new Map([['BANK_TRANSFER', true]]),
    );

    await service.create('org-1', dto, 'user-1');

    expect(prisma.invoice.create.mock.calls[0][0].data.paymentMethods).toEqual([
      'BANK_TRANSFER',
    ]);
    expect(charges.createCharge).not.toHaveBeenCalled();
  });

  it('records the sale of the items in the transaction that stores the invoice', async () => {
    const order: string[] = [];

    prisma.invoice.create.mockImplementation(async ({ data }: any) => {
      order.push('invoice');

      return { id: 'inv-1', ...data };
    });
    stock.recordSale.mockImplementation(async () => order.push('sale'));
    charges.createCharge.mockImplementation(async () => {
      order.push('bank-slip');

      return { record: { id: 'charge-1' } };
    });

    await service.create('org-1', buildDto(), 'user-1');

    expect(stock.recordSale).toHaveBeenCalledWith(prisma, {
      organizationId: 'org-1',
      invoiceId: 'inv-1',
      userId: 'user-1',
      lines: [expect.objectContaining({ id: 'item-1', quantity: 1 })],
    });
    expect(order).toEqual(['invoice', 'sale', 'bank-slip']);
    expect(stock.undoSale).not.toHaveBeenCalled();
  });

  it('removes the invoice and gives the stock back when the provider refuses the bank slip data', async () => {
    charges.createCharge.mockRejectedValue(
      new PaymentProviderError('CPF inválido', 'INVALID_DATA'),
    );

    await expect(
      service.create('org-1', buildDto(), 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(stock.undoSale).toHaveBeenCalledWith(prisma, 'inv-1');
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

    await service.create('org-1', buildDto(), 'user-1');

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

    await expect(
      service.create('org-1', buildDto(), 'user-1'),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(prisma.invoice.delete).toHaveBeenCalled();
  });

  it('rejects business rule violations before touching the database or the gateway', async () => {
    const dto = buildDto();
    dto.discount!.methods[1].method = 'BANK_SLIP';

    await expect(service.create('org-1', dto, 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.client.findFirst).not.toHaveBeenCalled();
    expect(prisma.invoice.create).not.toHaveBeenCalled();
    expect(stock.recordSale).not.toHaveBeenCalled();
    expect(charges.createCharge).not.toHaveBeenCalled();
  });

  describe('promotions', () => {
    /** Item de R$ 100 × 10 com a promoção de R$ 20 por unidade, até 3 unidades. */
    function promotionDto(name = 'Natal'): CreateInvoiceDto {
      return buildDto({
        items: [
          {
            item: {
              id: 'item-1',
              name: 'Produto',
              type: 'product',
              price: 100,
            },
            quantity: 10,
            total: 1000,
          },
        ],
        discount: {
          items: [
            {
              id: 'item-1',
              type: 'FIXED',
              value: 20,
              promotion: {
                id: 'promo-1',
                name,
                application: 'UNIT',
                maxAmount: null,
                maxQuantity: 3,
              },
            },
          ],
          methods: [],
        },
      });
    }

    const registered = {
      id: 'promo-1',
      name: 'Natal 2026',
      type: 'FIXED',
      value: 20,
      application: 'UNIT',
      maxAmount: null,
      maxQuantity: 3,
      startsAt: null,
      endsAt: new Date('2026-12-31T00:00:00Z'),
      active: true,
      items: [{ itemId: 'item-1' }],
    };

    beforeEach(() => {
      prisma.promotion = { findMany: vi.fn().mockResolvedValue([registered]) };
    });

    it('stores the promotion rules with its current name and the discount they give', async () => {
      await service.create('org-1', promotionDto(), 'user-1');

      expect(prisma.promotion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['promo-1'] }, organizationId: 'org-1' },
        }),
      );

      const { data } = prisma.invoice.create.mock.calls[0][0];

      expect(data.totalValue).toBe(940);
      expect(data.discount.items).toEqual([
        {
          id: 'item-1',
          type: 'FIXED',
          value: 20,
          promotion: {
            id: 'promo-1',
            name: 'Natal 2026',
            application: 'UNIT',
            maxAmount: null,
            maxQuantity: 3,
          },
        },
      ]);
    });

    it('rejects a promotion that is not of the organization before creating the invoice', async () => {
      prisma.promotion.findMany.mockResolvedValue([]);

      await expect(
        service.create('org-1', promotionDto(), 'user-1'),
      ).rejects.toThrow('A promoção aplicada ao item não existe mais');
      expect(prisma.invoice.create).not.toHaveBeenCalled();
    });

    it('rejects a promotion that expired since it was applied', async () => {
      prisma.promotion.findMany.mockResolvedValue([
        { ...registered, endsAt: new Date('2026-10-14T00:00:00Z') },
      ]);

      await expect(
        service.create('org-1', promotionDto(), 'user-1'),
      ).rejects.toThrow('A promoção Natal 2026 venceu em 14/10/2026');
    });

    it('does not look for promotions when the discounts were typed', async () => {
      await service.create('org-1', buildDto(), 'user-1');

      expect(prisma.promotion.findMany).not.toHaveBeenCalled();
      expect(
        prisma.invoice.create.mock.calls[0][0].data.discount.items,
      ).toEqual([
        { id: 'item-1', type: 'PERCENTAGE', value: 1, promotion: null },
      ]);
    });
  });

  it('requires a client of the organization that was not deleted', async () => {
    prisma.client.findFirst.mockResolvedValue(null);

    await expect(
      service.create('org-1', buildDto(), 'user-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.client.findFirst).toHaveBeenCalledWith({
      where: { id: 'client-1', organizationId: 'org-1', deletedAt: null },
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

    const result = await service.findAll('org-1', { page: 1, limit: 10 });
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

  it('filters the listing by client, creation day and displayed status', async () => {
    await service.findAll('org-1', {
      page: 2,
      limit: 20,
      clientId: 'client-1',
      createdAt: '2026-10-01',
      status: 'OVERDUE',
    });

    const query = prisma.invoice.findMany.mock.calls[0][0];

    expect(query).toMatchObject({
      where: {
        organizationId: 'org-1',
        clientId: 'client-1',
        createdAt: {
          gte: new Date('2026-10-01T00:00:00.000Z'),
          lte: new Date('2026-10-01T23:59:59.999Z'),
        },
        // Vencida também é a pendente com o vencimento antes de hoje (15/10 em São Paulo)
        AND: [
          {
            OR: [
              { status: 'OVERDUE' },
              {
                status: 'PENDING',
                dueDate: { lt: new Date('2026-10-15T00:00:00Z') },
              },
            ],
          },
        ],
      },
      skip: 20,
      take: 20,
    });
    expect(prisma.invoice.count).toHaveBeenCalledWith({ where: query.where });
  });

  describe('totals', () => {
    const today = new Date('2026-10-15T00:00:00Z');

    it('sums open, overdue and paid invoices of the client by the displayed status', async () => {
      prisma.invoice.aggregate = vi
        .fn()
        .mockResolvedValueOnce({
          _count: { _all: 2 },
          _sum: { totalValue: 150.1 },
        })
        .mockResolvedValueOnce({
          _count: { _all: 1 },
          _sum: { totalValue: 99.9 },
        })
        .mockResolvedValueOnce({
          _count: { _all: 3 },
          _sum: { paidValue: 0.1 + 0.2 },
        })
        .mockResolvedValueOnce({ _sum: { totalValue: 50 } });

      await expect(service.totals('org-1', 'client-1')).resolves.toEqual({
        open: { count: 2, total: 150.1 },
        overdue: { count: 1, total: 99.9 },
        // Valor recebido mais o nominal das pagas sem ele, em centavos
        paid: { count: 3, total: 50.3 },
      });

      const [open, overdue, paid, paidWithoutValue] =
        prisma.invoice.aggregate.mock.calls.map(([args]: any[]) => args);

      // Em aberto inclui a que aguarda a conferência de um comprovante
      expect(open).toEqual({
        where: {
          organizationId: 'org-1',
          clientId: 'client-1',
          AND: [
            {
              OR: [
                { status: 'PENDING', dueDate: { gte: today } },
                { status: 'AWAITING_CONFIRMATION' },
              ],
            },
          ],
        },
        _count: { _all: true },
        _sum: { totalValue: true },
      });
      expect(overdue.where.AND[0].OR).toContainEqual({
        status: 'PENDING',
        dueDate: { lt: today },
      });
      expect(paid).toMatchObject({
        where: { AND: [{ status: 'PAID' }] },
        _sum: { paidValue: true },
      });
      expect(paidWithoutValue).toMatchObject({
        where: { AND: [{ status: 'PAID' }], paidValue: null },
        _sum: { totalValue: true },
      });
    });

    it('sums the whole organization without a client, with zero when there are no invoices', async () => {
      prisma.invoice.aggregate = vi.fn().mockResolvedValue({
        _count: { _all: 0 },
        _sum: { totalValue: null, paidValue: null },
      });

      await expect(service.totals('org-1', null)).resolves.toEqual({
        open: { count: 0, total: 0 },
        overdue: { count: 0, total: 0 },
        paid: { count: 0, total: 0 },
      });
      expect(
        prisma.invoice.aggregate.mock.calls[0][0].where,
      ).not.toHaveProperty('clientId');
    });
  });

  it('counts the invoices awaiting the confirmation of a proof', async () => {
    prisma.invoice.count.mockResolvedValue(3);

    await expect(service.awaitingConfirmationCount('org-1')).resolves.toEqual({
      count: 3,
    });
    expect(prisma.invoice.count).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', status: 'AWAITING_CONFIRMATION' },
    });
  });

  it('shows a pending invoice past its due date as overdue', async () => {
    prisma.invoice.findFirst.mockResolvedValue(
      storedInvoice({ dueDate: new Date('2026-10-10T00:00:00Z') }),
    );

    await expect(service.findOne('inv-1', 'org-1')).resolves.toMatchObject({
      status: 'OVERDUE',
    });
  });

  it('returns the transactions and the balance of the invoice', async () => {
    const operator = { id: 'user-1', name: 'Ana' };
    prisma.invoice.findFirst.mockResolvedValue(
      storedInvoice({
        status: 'PAID',
        transactions: [
          {
            id: 'tx-pix',
            type: 'PAYMENT',
            status: 'CONFIRMED',
            source: 'GATEWAY',
            method: 'PIX',
            amount: new Prisma.Decimal('100.00'),
            occurredAt: new Date('2026-10-10T00:00:00Z'),
            createdAt: new Date('2026-10-10T12:00:00Z'),
            chargeId: 'charge-pix',
            statusReason: null,
            bankReference: null,
            proofKey: null,
            proofName: null,
            proofMimeType: null,
            notes: null,
            reviewedAt: null,
            cancelledAt: null,
            createdBy: null,
            reviewedBy: null,
            cancelledBy: null,
          },
          {
            id: 'tx-slip',
            type: 'PAYMENT',
            status: 'CONFIRMED',
            source: 'GATEWAY',
            method: 'BANK_SLIP',
            amount: new Prisma.Decimal('100.00'),
            occurredAt: new Date('2026-10-11T00:00:00Z'),
            createdAt: new Date('2026-10-11T12:00:00Z'),
            chargeId: 'charge-slip',
            statusReason: null,
            bankReference: null,
            proofKey: null,
            proofName: null,
            proofMimeType: null,
            notes: null,
            reviewedAt: null,
            cancelledAt: null,
            createdBy: null,
            reviewedBy: null,
            cancelledBy: null,
          },
          {
            id: 'tx-refund',
            type: 'REFUND',
            status: 'CONFIRMED',
            source: 'OPERATOR',
            method: 'BANK_TRANSFER',
            amount: new Prisma.Decimal('40.00'),
            occurredAt: new Date('2026-10-12T00:00:00Z'),
            createdAt: new Date('2026-10-12T12:00:00Z'),
            chargeId: null,
            statusReason: null,
            bankReference: 'E2E123',
            proofKey: 'organizations/org-1/invoices/inv-1/tx-refund.pdf',
            proofName: 'ted.pdf',
            proofMimeType: 'application/pdf',
            notes: null,
            reviewedAt: new Date('2026-10-12T12:00:00Z'),
            cancelledAt: null,
            createdBy: operator,
            reviewedBy: operator,
            cancelledBy: null,
          },
        ],
      }),
    );

    const invoice = await service.findOne('inv-1', 'org-1');

    expect(invoice.balance).toEqual({
      totalPaid: 200,
      totalRefunded: 40,
      net: 160,
      due: 100,
      balance: -60,
      excess: 60,
    });
    expect(invoice.transactions[2]).toEqual({
      id: 'tx-refund',
      type: 'REFUND',
      status: 'CONFIRMED',
      source: 'OPERATOR',
      method: 'BANK_TRANSFER',
      amount: 40,
      occurredAt: '2026-10-12',
      createdAt: new Date('2026-10-12T12:00:00Z'),
      statusReason: null,
      bankReference: 'E2E123',
      proofName: 'ted.pdf',
      proofMimeType: 'application/pdf',
      hasProof: true,
      notes: null,
      reviewedAt: new Date('2026-10-12T12:00:00Z'),
      cancelledAt: null,
      createdBy: operator,
      reviewedBy: operator,
      cancelledBy: null,
    });
    expect(invoice.transactions[0]).toMatchObject({
      amount: 100,
      hasProof: false,
    });
    expect(invoice.transactions[0]).not.toHaveProperty('proofKey');
  });

  describe('manual methods', () => {
    const releasedOrganization = {
      bankTransferEnabled: true,
      pixMode: 'MANUAL',
      bankAccount: {
        bankCode: '341',
        branch: '0001',
        accountNumber: '12345-6',
        accountType: 'CHECKING',
        holderName: 'Raipp Ltda',
        holderDocument: '11222333000181',
        pixKeyType: 'CNPJ',
        pixKey: '11222333000181',
      },
    };

    it('lists the manual methods of the invoice released for the organization', async () => {
      prisma.invoice.findFirst.mockResolvedValue(
        storedInvoice({
          paymentMethods: ['BANK_SLIP', 'PIX', 'BANK_TRANSFER'],
          organization: releasedOrganization,
        }),
      );

      const invoice = await service.findOne('inv-1', 'org-1');

      expect(invoice.manualMethods).toEqual(['BANK_TRANSFER', 'PIX']);
      // A conta da empresa não sai no detalhe da fatura
      expect(invoice).not.toHaveProperty('organization');
    });

    it('keeps only the locked method', async () => {
      prisma.invoice.findFirst.mockResolvedValue(
        storedInvoice({
          status: 'AWAITING_CONFIRMATION',
          paymentMethods: ['PIX', 'BANK_TRANSFER'],
          organization: releasedOrganization,
          transactions: [
            {
              id: 'tx-proof',
              type: 'PAYMENT',
              status: 'PENDING_REVIEW',
              source: 'CHECKOUT',
              method: 'PIX',
              amount: null,
              occurredAt: null,
              createdAt: new Date('2026-10-14T12:00:00Z'),
              chargeId: null,
              statusReason: null,
              bankReference: null,
              proofKey: 'organizations/org-1/invoices/inv-1/tx-proof.pdf',
              proofName: 'pix.pdf',
              proofMimeType: 'application/pdf',
              notes: null,
              reviewedAt: null,
              cancelledAt: null,
              createdBy: null,
              reviewedBy: null,
              cancelledBy: null,
            },
          ],
        }),
      );

      await expect(service.findOne('inv-1', 'org-1')).resolves.toMatchObject({
        status: 'AWAITING_CONFIRMATION',
        manualMethods: ['PIX'],
      });
    });

    it('has none without the releases', async () => {
      prisma.invoice.findFirst.mockResolvedValue(
        storedInvoice({ paymentMethods: ['PIX', 'BANK_TRANSFER'] }),
      );

      await expect(service.findOne('inv-1', 'org-1')).resolves.toMatchObject({
        manualMethods: [],
      });
    });
  });

  it('lists only the invoices with excess to refund', async () => {
    await service.findAll('org-1', { page: 1, limit: 10, hasExcess: true });

    expect(prisma.invoice.findMany.mock.calls[0][0].where).toEqual({
      organizationId: 'org-1',
      excessValue: { gt: 0 },
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
