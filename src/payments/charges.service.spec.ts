import { Logger } from '@nestjs/common';
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
  let transactions: any;
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
        findMany: vi.fn().mockResolvedValue([]),
      },
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

    transactions = {
      recordGatewayPayment: vi.fn(),
      applyBalance: vi.fn(),
      syncReceipts: vi.fn().mockResolvedValue(undefined),
    };

    service = new ChargesService(
      prisma,
      customers,
      new PaymentProviderRegistry([provider]),
      transactions,
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
    const paidEvent = {
      invoiceId: 'inv-1',
      organizationId: 'org-1',
      transactionId: 'tx-1',
      chargeId: 'charge-pix',
      method: 'PIX',
      paidAt: '2026-10-16T10:00:00.000Z',
      paidValue: 98.01,
    };
    const confirm = (
      receiptUrl: string | null = null,
      creditDate: Date | null = null,
    ) =>
      service.markPaid(tx, 'charge-pix', {
        paidAt,
        paidValue: 98.01,
        creditDate,
        receiptUrl,
      });

    beforeEach(() => {
      tx.invoiceCharge.findUniqueOrThrow.mockResolvedValue({
        id: 'charge-pix',
        method: 'PIX',
        status: 'PENDING',
        paidAt: null,
        paidValue: null,
        details: { pixPayload: 'copia-e-cola' },
        invoice: { id: 'inv-1', organizationId: 'org-1', status: 'PENDING' },
      });
      transactions.recordGatewayPayment.mockResolvedValue({
        transaction: { id: 'tx-1' },
        created: true,
      });
      transactions.applyBalance.mockResolvedValue({
        status: 'PAID',
        paidEvent,
      });
    });

    it('marks the charge as paid and records the payment in the invoice transactions', async () => {
      await confirm();

      expect(tx.invoiceCharge.update).toHaveBeenCalledWith({
        where: { id: 'charge-pix' },
        data: { status: 'PAID', paidAt, paidValue: 98.01 },
      });
      expect(transactions.recordGatewayPayment).toHaveBeenCalledWith(tx, {
        invoiceId: 'inv-1',
        chargeId: 'charge-pix',
        method: 'PIX',
        amount: 98.01,
        occurredAt: paidAt,
      });
      expect(transactions.applyBalance).toHaveBeenCalledWith(tx, 'inv-1');
    });

    it('returns the paid event of the balance', async () => {
      await expect(confirm()).resolves.toEqual(paidEvent);
    });

    it('does not record the payment again on a repeated event', async () => {
      tx.invoiceCharge.findUniqueOrThrow.mockResolvedValue({
        id: 'charge-pix',
        method: 'PIX',
        status: 'PAID',
        paidAt,
        paidValue: 98.01,
        details: {},
        invoice: { id: 'inv-1', organizationId: 'org-1', status: 'PAID' },
      });
      transactions.recordGatewayPayment.mockResolvedValue({
        transaction: { id: 'tx-1' },
        created: false,
      });

      await expect(confirm()).resolves.toBeNull();

      expect(transactions.applyBalance).not.toHaveBeenCalled();
      expect(tx.invoiceCharge.update).not.toHaveBeenCalled();
      expect(transactions.syncReceipts).not.toHaveBeenCalled();
    });

    it('stores the credit date informed with the payment', async () => {
      const creditDate = new Date('2026-11-16T00:00:00Z');

      await confirm(null, creditDate);

      expect(tx.invoiceCharge.update).toHaveBeenCalledWith({
        where: { id: 'charge-pix' },
        data: { status: 'PAID', paidAt, paidValue: 98.01, creditDate },
      });
      // A transação nova recalcula a fatura, e o recebimento sai junto
      expect(transactions.applyBalance).toHaveBeenCalledWith(tx, 'inv-1');
      expect(transactions.syncReceipts).not.toHaveBeenCalled();
    });

    it('updates the credit date of a repeated event and the receipt in the financial module', async () => {
      const creditDate = new Date('2026-11-17T00:00:00Z');
      tx.invoiceCharge.findUniqueOrThrow.mockResolvedValue({
        id: 'charge-pix',
        method: 'CREDIT_CARD',
        status: 'PAID',
        paidAt,
        paidValue: 98.01,
        creditDate: new Date('2026-11-16T00:00:00Z'),
        details: {},
        invoice: { id: 'inv-1', organizationId: 'org-1', status: 'PAID' },
      });
      transactions.recordGatewayPayment.mockResolvedValue({
        transaction: { id: 'tx-1' },
        created: false,
      });

      await expect(confirm(null, creditDate)).resolves.toBeNull();

      expect(tx.invoiceCharge.update).toHaveBeenCalledWith({
        where: { id: 'charge-pix' },
        data: { creditDate },
      });
      expect(transactions.syncReceipts).toHaveBeenCalledWith(tx, 'inv-1');
      expect(transactions.applyBalance).not.toHaveBeenCalled();
    });

    it('does not touch the charge when the credit date did not change', async () => {
      const creditDate = new Date('2026-11-16T00:00:00Z');
      tx.invoiceCharge.findUniqueOrThrow.mockResolvedValue({
        id: 'charge-pix',
        method: 'CREDIT_CARD',
        status: 'PAID',
        paidAt,
        paidValue: 98.01,
        creditDate: new Date('2026-11-16T00:00:00Z'),
        details: {},
        invoice: { id: 'inv-1', organizationId: 'org-1', status: 'PAID' },
      });
      transactions.recordGatewayPayment.mockResolvedValue({
        transaction: { id: 'tx-1' },
        created: false,
      });

      await confirm(null, creditDate);

      expect(tx.invoiceCharge.update).not.toHaveBeenCalled();
      expect(transactions.syncReceipts).not.toHaveBeenCalled();
    });

    it('records a card charge that was already born paid', async () => {
      const cardPaidAt = new Date('2026-10-16T09:59:58Z');
      tx.invoiceCharge.findUniqueOrThrow.mockResolvedValue({
        id: 'charge-card',
        method: 'CREDIT_CARD',
        status: 'PAID',
        paidAt: cardPaidAt,
        paidValue: 100,
        details: {},
        invoice: { id: 'inv-1', organizationId: 'org-1', status: 'PENDING' },
      });

      await expect(confirm()).resolves.toEqual(paidEvent);

      expect(transactions.recordGatewayPayment).toHaveBeenCalledWith(tx, {
        invoiceId: 'inv-1',
        chargeId: 'charge-card',
        method: 'CREDIT_CARD',
        amount: 100,
        occurredAt: cardPaidAt,
      });
      expect(transactions.applyBalance).toHaveBeenCalledWith(tx, 'inv-1');
    });

    it('records a duplicate payment as excess, without an error log', async () => {
      const errorLog = vi.spyOn(Logger.prototype, 'error');
      const warnLog = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      tx.invoiceCharge.findUniqueOrThrow.mockResolvedValue({
        id: 'charge-slip',
        method: 'BANK_SLIP',
        status: 'PENDING',
        paidAt: null,
        paidValue: null,
        details: null,
        invoice: { id: 'inv-1', organizationId: 'org-1', status: 'PAID' },
      });
      transactions.applyBalance.mockResolvedValue({
        status: 'PAID',
        paidEvent: null,
      });

      await expect(confirm()).resolves.toBeNull();

      expect(transactions.recordGatewayPayment).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ chargeId: 'charge-slip', amount: 98.01 }),
      );
      expect(errorLog).not.toHaveBeenCalled();
      expect(warnLog).toHaveBeenCalledWith(
        expect.stringContaining('duplicidade na fatura inv-1'),
      );

      errorLog.mockRestore();
      warnLog.mockRestore();
    });

    it('cancels the other open charges of the invoice in their providers', async () => {
      const bankSlip = {
        id: 'charge-slip',
        externalId: 'pay_slip',
        paymentGatewayAccount: { id: 'acc-1', provider: 'ALPHA' },
      };
      tx.invoiceCharge.findMany.mockResolvedValue([bankSlip]);

      await confirm();

      expect(tx.invoiceCharge.findMany).toHaveBeenCalledWith({
        where: {
          invoiceId: 'inv-1',
          status: 'PENDING',
          id: { not: 'charge-pix' },
        },
        include: { paymentGatewayAccount: true },
      });
      expect(provider.cancelCharge).toHaveBeenCalledWith(
        bankSlip.paymentGatewayAccount,
        'pay_slip',
      );
      expect(tx.invoiceCharge.update).toHaveBeenCalledWith({
        where: { id: 'charge-slip' },
        data: { status: 'CANCELLED' },
      });
    });

    it('keeps the other charges open while the invoice is not settled', async () => {
      transactions.applyBalance.mockResolvedValue({
        status: 'PENDING',
        paidEvent: null,
      });

      await confirm();

      expect(tx.invoiceCharge.findMany).not.toHaveBeenCalled();
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

      await expect(confirm()).resolves.toEqual(paidEvent);
    });

    it('stores the receipt sent with the payment', async () => {
      await confirm('https://asaas.com/comprovantes/1');

      expect(tx.invoiceCharge.update).toHaveBeenCalledWith({
        where: { id: 'charge-pix' },
        data: {
          status: 'PAID',
          paidAt,
          paidValue: 98.01,
          details: {
            pixPayload: 'copia-e-cola',
            receiptUrl: 'https://asaas.com/comprovantes/1',
          },
        },
      });
    });

    it('adds a late receipt to a charge already paid, without a new paid event', async () => {
      tx.invoiceCharge.findUniqueOrThrow.mockResolvedValue({
        id: 'charge-pix',
        method: 'PIX',
        status: 'PAID',
        paidAt,
        paidValue: 98.01,
        details: { receiptUrl: null },
        invoice: { id: 'inv-1', organizationId: 'org-1', status: 'PAID' },
      });
      transactions.recordGatewayPayment.mockResolvedValue({
        transaction: { id: 'tx-1' },
        created: false,
      });

      await expect(
        confirm('https://asaas.com/comprovantes/1'),
      ).resolves.toBeNull();

      expect(tx.invoiceCharge.update).toHaveBeenCalledWith({
        where: { id: 'charge-pix' },
        data: { details: { receiptUrl: 'https://asaas.com/comprovantes/1' } },
      });
      expect(transactions.applyBalance).not.toHaveBeenCalled();
    });
  });

  describe('cancelOpenCharges', () => {
    it('cancels every open charge when no charge paid the invoice (manual payment)', async () => {
      await service.cancelOpenCharges(tx, 'inv-1', null);

      expect(tx.invoiceCharge.findMany).toHaveBeenCalledWith({
        where: { invoiceId: 'inv-1', status: 'PENDING' },
        include: { paymentGatewayAccount: true },
      });
    });
  });
});
