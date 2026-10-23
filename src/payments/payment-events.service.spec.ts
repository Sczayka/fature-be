import { PaymentEventsService } from './payment-events.service.js';
import type { PaymentEvent } from './providers/payment-provider.js';

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

function paymentEvent(overrides: Partial<PaymentEvent> = {}): PaymentEvent {
  return {
    externalEventId: 'evt_1',
    type: 'CHARGE_PAID',
    providerType: 'PAYMENT_RECEIVED',
    chargeExternalId: 'pay_1',
    paidAt: '2026-10-16',
    paidValue: 98.01,
    creditDate: null,
    receiptUrl: null,
    raw: { id: 'evt_1' },
    ...overrides,
  };
}

describe('PaymentEventsService', () => {
  let prisma: any;
  let tx: any;
  let charges: any;
  let eventEmitter: any;
  let service: PaymentEventsService;

  beforeEach(() => {
    tx = {
      invoice: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      invoiceCharge: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma = {
      paymentGatewayEvent: {
        upsert: vi
          .fn()
          .mockResolvedValue({ id: 'stored-1', processedAt: null }),
        update: vi.fn().mockResolvedValue({}),
      },
      invoiceCharge: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'charge-1',
          invoiceId: 'inv-1',
          value: 98.01,
        }),
      },
    };
    charges = {
      withInvoiceLock: vi
        .fn()
        .mockImplementation((_id: string, work: any) => work(tx)),
      markPaid: vi.fn().mockResolvedValue(null),
    };
    eventEmitter = { emit: vi.fn() };

    service = new PaymentEventsService(prisma, charges, eventEmitter);
  });

  it('passes the credit date of the provider to the payment confirmation', async () => {
    await service.handle('ALPHA', [paymentEvent({ creditDate: '2026-11-16' })]);

    expect(charges.markPaid.mock.calls[0][2]).toMatchObject({
      creditDate: new Date('2026-11-16T00:00:00Z'),
    });
  });

  it('confirms the payment of the charge under the invoice lock and marks the event as processed', async () => {
    await service.handle('ALPHA', [paymentEvent()]);

    expect(prisma.invoiceCharge.findFirst).toHaveBeenCalledWith({
      where: {
        externalId: 'pay_1',
        paymentGatewayAccount: { provider: 'ALPHA' },
      },
    });
    expect(charges.withInvoiceLock).toHaveBeenCalledWith(
      'inv-1',
      expect.any(Function),
    );
    expect(charges.markPaid).toHaveBeenCalledWith(tx, 'charge-1', {
      paidAt: new Date('2026-10-16'),
      paidValue: 98.01,
      creditDate: null,
      receiptUrl: null,
    });
    expect(prisma.paymentGatewayEvent.update).toHaveBeenCalledWith({
      where: { id: 'stored-1' },
      data: { processedAt: expect.any(Date) },
    });
  });

  it('applies a repeated event only once', async () => {
    prisma.paymentGatewayEvent.upsert.mockResolvedValue({
      id: 'stored-1',
      processedAt: new Date(),
    });

    await service.handle('ALPHA', [paymentEvent()]);

    expect(charges.markPaid).not.toHaveBeenCalled();
  });

  it('records but ignores events of charges created outside the Fature', async () => {
    prisma.invoiceCharge.findFirst.mockResolvedValue(null);

    await service.handle('ALPHA', [paymentEvent()]);

    expect(charges.withInvoiceLock).not.toHaveBeenCalled();
    expect(prisma.paymentGatewayEvent.update).toHaveBeenCalled();
  });

  it('marks a pending invoice as overdue', async () => {
    await service.handle('ALPHA', [paymentEvent({ type: 'CHARGE_OVERDUE' })]);

    expect(tx.invoice.updateMany).toHaveBeenCalledWith({
      where: { id: 'inv-1', status: 'PENDING' },
      data: { status: 'OVERDUE' },
    });
  });

  it('marks a removed charge as cancelled', async () => {
    await service.handle('ALPHA', [paymentEvent({ type: 'CHARGE_CANCELLED' })]);

    expect(tx.invoiceCharge.updateMany).toHaveBeenCalledWith({
      where: { id: 'charge-1', status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
  });

  it('leaves the event unprocessed when applying it fails, so the provider resends it', async () => {
    charges.markPaid.mockRejectedValue(new Error('db down'));

    await expect(service.handle('ALPHA', [paymentEvent()])).rejects.toThrow(
      'db down',
    );
    expect(prisma.paymentGatewayEvent.update).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  describe('invoice paid event', () => {
    const paidEvent = {
      invoiceId: 'inv-1',
      organizationId: 'org-1',
      chargeId: 'charge-1',
      method: 'PIX',
      paidAt: '2026-10-16T00:00:00.000Z',
      paidValue: 98.01,
    };

    it('emits the event after the invoice lock is released', async () => {
      const order: string[] = [];

      charges.withInvoiceLock.mockImplementation(
        async (_id: string, work: any) => {
          const result = await work(tx);

          order.push('commit');

          return result;
        },
      );
      charges.markPaid.mockResolvedValue(paidEvent);
      eventEmitter.emit.mockImplementation(() => order.push('emit'));

      await service.handle('ALPHA', [
        paymentEvent({ receiptUrl: 'https://asaas.com/comprovantes/1' }),
      ]);

      expect(charges.markPaid).toHaveBeenCalledWith(tx, 'charge-1', {
        paidAt: new Date('2026-10-16'),
        paidValue: 98.01,
        creditDate: null,
        receiptUrl: 'https://asaas.com/comprovantes/1',
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith('invoice.paid', paidEvent);
      expect(order).toEqual(['commit', 'emit']);
    });

    it('does not emit when the invoice was already paid', async () => {
      await service.handle('ALPHA', [paymentEvent()]);

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('does not emit when the transaction fails', async () => {
      charges.markPaid.mockResolvedValue(paidEvent);
      charges.withInvoiceLock.mockImplementation(
        async (_id: string, work: any) => {
          await work(tx);

          throw new Error('commit failed');
        },
      );

      await expect(service.handle('ALPHA', [paymentEvent()])).rejects.toThrow(
        'commit failed',
      );
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });
});
