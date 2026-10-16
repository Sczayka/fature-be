import { ChargesService } from './charges.service.js';
import { PaymentProviderError } from './providers/payment-provider.js';
import { PaymentProviderRegistry } from './providers/payment-provider.registry.js';

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

describe('ChargesService', () => {
  const client = { id: 'client-1' } as any;
  let prisma: any;
  let tx: any;
  let customers: any;
  let provider: any;
  let service: ChargesService;

  const route = () =>
    ({
      method: 'PIX',
      account: { id: 'acc-1', provider: 'ALPHA' },
      provider,
      fee: { fixed: 1, percent: 0 },
      cost: { fixed: 0.3, percent: 0 },
    }) as any;

  beforeEach(() => {
    tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      invoiceCharge: {
        findUniqueOrThrow: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
      },
      invoice: { update: vi.fn().mockResolvedValue({}) },
    };
    prisma = {
      invoiceCharge: {
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      },
      $transaction: vi.fn().mockImplementation((work) => work(tx)),
    };
    customers = { ensureCustomer: vi.fn().mockResolvedValue('cus_1') };
    provider = {
      code: 'ALPHA',
      capabilities: {
        methods: ['PIX', 'CREDIT_CARD'],
        cardCapture: 'RAW',
        supportsSplit: true,
      },
      createCharge: vi.fn().mockResolvedValue({
        externalId: 'pay_1',
        status: 'PENDING',
        details: { pixPayload: '000201' },
        raw: { id: 'pay_1' },
      }),
      cancelCharge: vi.fn().mockResolvedValue(undefined),
      findChargesByReference: vi.fn().mockResolvedValue([]),
    };

    service = new ChargesService(
      prisma,
      customers,
      new PaymentProviderRegistry([provider]),
    );
  });

  describe('createCharge', () => {
    const createPix = () =>
      service.createCharge({
        invoiceId: 'inv-1',
        client,
        route: route(),
        request: {
          method: 'PIX',
          value: 100,
          dueDate: '2026-10-30',
          description: 'Fatura',
        },
        validUntil: '2026-10-30',
      });

    const createCard = () =>
      service.createCharge({
        invoiceId: 'inv-1',
        client,
        route: route(),
        request: {
          method: 'CREDIT_CARD',
          value: 100,
          dueDate: '2026-10-16',
          description: 'Fatura',
          payerIp: '200.1.1.1',
          payment: { mode: 'PROVIDER_TOKEN', token: 'tok', holder: {} as any },
        },
        validUntil: null,
      });

    it('sends the charge with the customer, its own id as reference and the margin as split', async () => {
      const { record } = await createPix();
      const input = provider.createCharge.mock.calls[0][1];

      expect(customers.ensureCustomer).toHaveBeenCalledWith(
        { id: 'acc-1', provider: 'ALPHA' },
        client,
      );
      expect(input).toMatchObject({
        method: 'PIX',
        value: 100,
        customerExternalId: 'cus_1',
        reference: record.id,
        splitAmount: 0.7,
      });
    });

    it('stores the charge with the fee, cost and split snapshot', async () => {
      const { record } = await createPix();

      expect(record).toMatchObject({
        invoiceId: 'inv-1',
        method: 'PIX',
        paymentGatewayAccountId: 'acc-1',
        externalId: 'pay_1',
        status: 'PENDING',
        value: 100,
        feeFixed: 1,
        costFixed: 0.3,
        feeAmount: 1,
        costAmount: 0.3,
        splitAmount: 0.7,
        details: { pixPayload: '000201' },
      });
      expect(record.validUntil).toEqual(new Date('2026-10-30'));
    });

    it('does not split when the provider does not support it', async () => {
      provider.capabilities.supportsSplit = false;

      await createPix();

      expect(provider.createCharge.mock.calls[0][1].splitAmount).toBe(0);
    });

    it('stores a charge already paid by the provider as paid', async () => {
      provider.createCharge.mockResolvedValue({
        externalId: 'pay_1',
        status: 'PAID',
        details: {},
        raw: {},
      });

      const { record, providerStatus } = await createPix();

      expect(providerStatus).toBe('PAID');
      expect(record).toMatchObject({ status: 'PAID', paidValue: 100 });
    });

    it('recovers a card charge by its reference when the response was lost', async () => {
      provider.createCharge.mockRejectedValue(
        new PaymentProviderError('timeout', 'UNAVAILABLE'),
      );
      provider.findChargesByReference.mockResolvedValue([
        { externalId: 'pay_9', status: 'PAID', details: {}, raw: {} },
      ]);

      const { record } = await createCard();

      expect(provider.findChargesByReference.mock.calls[0][1]).toBe(record.id);
      expect(record).toMatchObject({ externalId: 'pay_9', status: 'PAID' });
    });

    it('does not retry a refused card', async () => {
      provider.createCharge.mockRejectedValue(
        new PaymentProviderError('Recusado', 'CARD_REFUSED'),
      );

      await expect(createCard()).rejects.toMatchObject({
        kind: 'CARD_REFUSED',
      });
      expect(provider.findChargesByReference).not.toHaveBeenCalled();
    });
  });

  describe('withInvoiceLock', () => {
    it('takes a transaction-level advisory lock on the invoice before the work', async () => {
      const result = await service.withInvoiceLock('inv-1', async () => 'done');

      expect(result).toBe('done');
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      expect(tx.$executeRaw.mock.calls[0].slice(1)).toEqual(['inv-1']);
    });
  });

  describe('markPaid', () => {
    const paidAt = new Date('2026-10-16T10:00:00Z');

    beforeEach(() => {
      tx.invoiceCharge.findUniqueOrThrow.mockResolvedValue({
        id: 'charge-pix',
        method: 'PIX',
        status: 'PENDING',
        invoice: { id: 'inv-1', status: 'PENDING' },
      });
    });

    it('marks the charge and the invoice as paid', async () => {
      await service.markPaid(tx, 'charge-pix', { paidAt, paidValue: 98.01 });

      expect(tx.invoiceCharge.update).toHaveBeenCalledWith({
        where: { id: 'charge-pix' },
        data: { status: 'PAID', paidAt, paidValue: 98.01 },
      });
      expect(tx.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { status: 'PAID', paidAt, paidMethod: 'PIX', paidValue: 98.01 },
      });
    });

    it('cancels the other open charges of the invoice in their providers', async () => {
      const bankSlip = {
        id: 'charge-slip',
        externalId: 'pay_slip',
        paymentGatewayAccount: { id: 'acc-1', provider: 'ALPHA' },
      };
      tx.invoiceCharge.findMany.mockResolvedValue([bankSlip]);

      await service.markPaid(tx, 'charge-pix', { paidAt, paidValue: 98.01 });

      expect(provider.cancelCharge).toHaveBeenCalledWith(
        bankSlip.paymentGatewayAccount,
        'pay_slip',
      );
      expect(tx.invoiceCharge.update).toHaveBeenCalledWith({
        where: { id: 'charge-slip' },
        data: { status: 'CANCELLED' },
      });
    });

    it('keeps the confirmation when another charge cannot be cancelled', async () => {
      provider.cancelCharge.mockRejectedValue(new Error('boom'));
      tx.invoiceCharge.findMany.mockResolvedValue([
        {
          id: 'charge-slip',
          externalId: 'pay_slip',
          paymentGatewayAccount: { provider: 'ALPHA' },
        },
      ]);

      await expect(
        service.markPaid(tx, 'charge-pix', { paidAt, paidValue: 98.01 }),
      ).resolves.toBeUndefined();
      expect(tx.invoice.update).toHaveBeenCalled();
    });

    it('does not overwrite the payment of an invoice already paid by another charge', async () => {
      tx.invoiceCharge.findUniqueOrThrow.mockResolvedValue({
        id: 'charge-slip',
        method: 'BANK_SLIP',
        status: 'PENDING',
        invoice: { id: 'inv-1', status: 'PAID' },
      });
      tx.invoiceCharge.count.mockResolvedValue(1);

      await service.markPaid(tx, 'charge-slip', { paidAt, paidValue: 99 });

      expect(tx.invoice.update).not.toHaveBeenCalled();
      expect(tx.invoiceCharge.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PAID' }),
        }),
      );
    });
  });
});
