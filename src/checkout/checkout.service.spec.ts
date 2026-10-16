import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CheckoutService } from './checkout.service.js';
import { PaymentProviderError } from '../payments/providers/payment-provider.js';

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

const TOKEN = 'a'.repeat(32);

function buildInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    organizationId: 'org-1',
    status: 'PENDING',
    dueDate: new Date('2026-10-31T00:00:00Z'),
    description: 'Mensalidade',
    totalValue: 99,
    items: [
      {
        id: 'item-1',
        name: 'Produto',
        type: 'product',
        price: 100,
        quantity: 1,
        total: 100,
      },
    ],
    paymentMethods: ['BANK_SLIP', 'PIX', 'CREDIT_CARD'],
    discount: {
      items: [{ id: 'item-1', type: 'PERCENTAGE', value: 1 }],
      methods: [
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
    paidAt: null,
    paidMethod: null,
    paidValue: null,
    organization: { name: 'Empresa', logo: null },
    client: {
      id: 'client-1',
      name: 'Cliente',
      email: 'cliente@email.com',
      cpfCnpj: '12345678909',
    },
    charges: [
      {
        id: 'charge-slip',
        method: 'BANK_SLIP',
        status: 'PENDING',
        value: 99,
        dueDate: new Date('2026-10-31T00:00:00Z'),
        validUntil: null,
        paymentGatewayAccountId: 'acc-1',
        details: {
          bankSlipUrl: 'https://provider/b/1',
          identificationField: '23790.00009',
        },
      },
    ],
    ...overrides,
  };
}

const openPix = (overrides: Record<string, unknown> = {}) => ({
  id: 'charge-pix',
  method: 'PIX',
  status: 'PENDING',
  value: 98.01,
  dueDate: new Date('2026-10-30T00:00:00Z'),
  validUntil: new Date('2026-10-30T00:00:00Z'),
  paymentGatewayAccountId: 'acc-1',
  details: {
    pixPayload: '000201',
    pixQrCodeImage: 'iVBOR',
    pixExpiresAt: null,
  },
  ...overrides,
});

describe('CheckoutService', () => {
  let invoice: any;
  let prisma: any;
  let tx: any;
  let routing: any;
  let charges: any;
  let service: CheckoutService;

  const routeFor = (method: string) => ({
    method,
    account: { id: 'acc-1' },
    provider: {
      code: 'ALPHA',
      capabilities: {
        methods: ['BANK_SLIP', 'PIX', 'CREDIT_CARD'],
        cardCapture: 'RAW',
        supportsSplit: true,
      },
    },
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));

    invoice = buildInvoice();
    prisma = {
      invoice: { findUnique: vi.fn().mockImplementation(() => invoice) },
    };
    tx = {
      invoice: {
        findUniqueOrThrow: vi.fn().mockImplementation(() => invoice),
      },
    };
    routing = {
      getRoutes: vi.fn().mockImplementation(
        async () =>
          new Map<string, unknown>([
            ['BANK_SLIP', routeFor('BANK_SLIP')],
            ['PIX', routeFor('PIX')],
            ['CREDIT_CARD', routeFor('CREDIT_CARD')],
          ]),
      ),
      resolve: vi
        .fn()
        .mockImplementation(async (_org: string, method: string) =>
          routeFor(method),
        ),
    };
    charges = {
      withInvoiceLock: vi
        .fn()
        .mockImplementation((_id: string, work: any) => work(tx)),
      createCharge: vi.fn().mockImplementation(async ({ request }: any) => ({
        record: openPix({ value: request.value }),
        providerStatus: 'PENDING',
      })),
      cancelCharge: vi.fn().mockResolvedValue(undefined),
      markPaid: vi.fn().mockResolvedValue(undefined),
    };

    service = new CheckoutService(prisma, routing, charges);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getView', () => {
    it('offers each enabled method with the value of the day', async () => {
      const view = await service.getView(TOKEN);

      expect(view.options).toEqual([
        {
          method: 'BANK_SLIP',
          quote: expect.objectContaining({ total: 99 }),
          bankSlip: {
            url: 'https://provider/b/1',
            identificationField: '23790.00009',
          },
        },
        {
          method: 'CREDIT_CARD',
          quote: expect.objectContaining({ total: 99, discountUntil: null }),
          cardCapture: { mode: 'RAW' },
        },
        {
          method: 'PIX',
          quote: expect.objectContaining({
            total: 98.01,
            methodDiscount: 0.99,
            discountUntil: '2026-10-30',
          }),
          pix: null,
        },
      ]);
    });

    it('shows the issuer and only the name of the customer', async () => {
      const view: any = await service.getView(TOKEN);

      expect(view).toMatchObject({
        status: 'PENDING',
        issuer: { name: 'Empresa', logo: null },
        customerName: 'Cliente',
        dueDate: '2026-10-31',
        items: [{ name: 'Produto', quantity: 1, total: 100 }],
      });
      expect(JSON.stringify(view)).not.toContain('12345678909');
      expect(JSON.stringify(view)).not.toContain('cliente@email.com');
    });

    it('includes the open PIX while its value is still valid', async () => {
      invoice.charges.push(openPix());

      const view = await service.getView(TOKEN);
      const pixOption: any = view.options.find((o) => o.method === 'PIX');

      expect(pixOption.pix).toEqual({
        value: 98.01,
        validUntil: '2026-10-30',
        payload: '000201',
        qrCodeImage: 'iVBOR',
        expiresAt: null,
      });
    });

    it('hides methods without an available provider', async () => {
      routing.getRoutes.mockResolvedValue(new Map([['PIX', null]]));

      const view = await service.getView(TOKEN);

      expect(view.options.map((option) => option.method)).toEqual([
        'BANK_SLIP',
      ]);
    });

    it('shows a paid invoice with its payment and no options', async () => {
      invoice = buildInvoice({
        status: 'PAID',
        paidAt: new Date('2026-10-14T13:00:00Z'),
        paidMethod: 'PIX',
        paidValue: 98.01,
      });

      const view = await service.getView(TOKEN);

      expect(view.status).toBe('PAID');
      expect(view.payment).toEqual({
        paidAt: '2026-10-14T13:00:00.000Z',
        method: 'PIX',
        value: 98.01,
      });
      expect(view.options).toEqual([]);
    });

    it('shows a pending invoice past its due date as overdue, with fine and interest', async () => {
      invoice = buildInvoice({ dueDate: new Date('2026-10-05T00:00:00Z') });

      const view = await service.getView(TOKEN);
      const pixOption: any = view.options.find((o) => o.method === 'PIX');

      expect(view.status).toBe('OVERDUE');
      expect(pixOption.quote).toMatchObject({
        phase: 'OVERDUE',
        fine: 0.99,
        daysLate: 10,
      });
    });

    it('answers 404 to a malformed token without querying the database', async () => {
      await expect(service.getView('../../etc')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.invoice.findUnique).not.toHaveBeenCalled();
    });

    it('answers 404 to an unknown token', async () => {
      invoice = null;

      await expect(service.getView(TOKEN)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('createPix', () => {
    it('creates a PIX with the value of the day, valid until the discount limit date', async () => {
      const pix = await service.createPix(TOKEN);

      expect(charges.withInvoiceLock).toHaveBeenCalledWith(
        'inv-1',
        expect.any(Function),
      );
      expect(charges.createCharge).toHaveBeenCalledWith(
        expect.objectContaining({
          invoiceId: 'inv-1',
          request: {
            method: 'PIX',
            value: 98.01,
            dueDate: '2026-10-30',
            description: 'Mensalidade',
          },
          validUntil: '2026-10-30',
        }),
        tx,
      );
      expect(pix.payload).toBe('000201');
    });

    it('reuses the open PIX while its value is still valid', async () => {
      invoice.charges.push(openPix());

      await service.createPix(TOKEN);

      expect(charges.createCharge).not.toHaveBeenCalled();
      expect(charges.cancelCharge).not.toHaveBeenCalled();
    });

    it('replaces the open PIX when the value of the day changed', async () => {
      const stale = openPix({ value: 99 });
      invoice.charges.push(stale);

      await service.createPix(TOKEN);

      expect(charges.cancelCharge).toHaveBeenCalledWith(tx, stale);
      expect(charges.createCharge).toHaveBeenCalled();
    });

    it('does not create a new PIX when the open one cannot be cancelled', async () => {
      invoice.charges.push(openPix({ value: 99 }));
      charges.cancelCharge.mockRejectedValue(new Error('already paid'));

      await expect(service.createPix(TOKEN)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(charges.createCharge).not.toHaveBeenCalled();
    });

    it('refuses an invoice that is already paid', async () => {
      invoice = buildInvoice({ status: 'PAID' });

      await expect(service.createPix(TOKEN)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('refuses a method not enabled in the invoice', async () => {
      invoice = buildInvoice({ paymentMethods: ['BANK_SLIP'] });

      await expect(service.createPix(TOKEN)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('payWithCreditCard', () => {
    const dto: any = {
      mode: 'RAW',
      card: {
        holderName: 'TITULAR',
        number: '4444444444444444',
        expiryMonth: '12',
        expiryYear: '2030',
        ccv: '123',
      },
      holder: {
        name: 'Titular',
        email: 'titular@email.com',
        cpfCnpj: '12345678909',
        postalCode: '01001000',
        addressNumber: '10',
        phone: '11999999999',
      },
    };

    it('charges the value of the day and confirms the invoice when the card is approved', async () => {
      charges.createCharge.mockResolvedValue({
        record: { id: 'charge-card' },
        providerStatus: 'PAID',
      });

      await expect(
        service.payWithCreditCard(TOKEN, dto, '200.1.1.1'),
      ).resolves.toEqual({ status: 'PAID' });

      expect(charges.createCharge.mock.calls[0][0].request).toMatchObject({
        method: 'CREDIT_CARD',
        value: 99,
        dueDate: '2026-10-15',
        payerIp: '200.1.1.1',
        payment: { mode: 'RAW', card: dto.card, holder: dto.holder },
      });
      expect(charges.markPaid).toHaveBeenCalledWith(tx, 'charge-card', {
        paidAt: expect.any(Date),
        paidValue: 99,
      });
    });

    it('waits for the webhook when the card is under analysis', async () => {
      charges.createCharge.mockResolvedValue({
        record: { id: 'charge-card' },
        providerStatus: 'IN_ANALYSIS',
      });

      await expect(
        service.payWithCreditCard(TOKEN, dto, '200.1.1.1'),
      ).resolves.toEqual({ status: 'IN_ANALYSIS' });
      expect(charges.markPaid).not.toHaveBeenCalled();
    });

    it('answers a refused card with 422 and the generic message', async () => {
      charges.createCharge.mockRejectedValue(
        new PaymentProviderError('Pagamento não autorizado.', 'CARD_REFUSED'),
      );

      await expect(
        service.payWithCreditCard(TOKEN, dto, '200.1.1.1'),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('asks to reload the page when the capture mode of the provider changed', async () => {
      await expect(
        service.payWithCreditCard(
          TOKEN,
          { ...dto, mode: 'PROVIDER_TOKEN', token: 'tok' },
          '200.1.1.1',
        ),
      ).rejects.toThrow('Recarregue a página');
      expect(charges.createCharge).not.toHaveBeenCalled();
    });
  });
});
