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
    raw: { id: 'evt_1' },
    ...overrides,
  };
}

describe('PaymentEventsService', () => {
  let prisma: any;
  let tx: any;
  let charges: any;
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
        findFirst: vi
          .fn()
          .mockResolvedValue({
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
      markPaid: vi.fn().mockResolvedValue(undefined),
    };

    service = new PaymentEventsService(prisma, charges);
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
  });
});
