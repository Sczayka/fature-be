import { Prisma } from '@prisma/client';
import { InvoiceTransactionsService } from './invoice-transactions.service.js';

describe('InvoiceTransactionsService', () => {
  let tx: any;
  let service: InvoiceTransactionsService;

  const paidAt = new Date('2026-10-16T00:00:00Z');

  function payment(overrides: Record<string, unknown> = {}) {
    return {
      id: 'tx-pix',
      type: 'PAYMENT',
      status: 'CONFIRMED',
      source: 'GATEWAY',
      method: 'PIX',
      amount: new Prisma.Decimal(100),
      occurredAt: paidAt,
      createdAt: new Date('2026-10-16T10:00:00Z'),
      chargeId: 'charge-pix',
      ...overrides,
    };
  }

  function invoice(overrides: Record<string, unknown> = {}) {
    return {
      id: 'inv-1',
      organizationId: 'org-1',
      status: 'PENDING',
      items: [{ id: 'item-1', total: 100 }],
      dueDate: new Date('2026-10-30T00:00:00Z'),
      discount: null,
      interestAndFine: null,
      transactions: [payment()],
      ...overrides,
    };
  }

  beforeEach(() => {
    tx = {
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(invoice()),
        update: vi.fn().mockResolvedValue({}),
      },
      invoiceTransaction: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      },
    };
    service = new InvoiceTransactionsService();
  });

  describe('recordGatewayPayment', () => {
    const input = {
      invoiceId: 'inv-1',
      chargeId: 'charge-pix',
      method: 'PIX',
      amount: 98.01,
      occurredAt: paidAt,
    };

    it('creates a confirmed payment from the provider', async () => {
      const { transaction, created } = await service.recordGatewayPayment(
        tx,
        input,
      );

      expect(created).toBe(true);
      expect(transaction).toMatchObject({
        invoiceId: 'inv-1',
        chargeId: 'charge-pix',
        type: 'PAYMENT',
        method: 'PIX',
        amount: 98.01,
        occurredAt: paidAt,
        status: 'CONFIRMED',
        source: 'GATEWAY',
      });
      expect(transaction.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('returns the payment already recorded for the charge', async () => {
      const existing = payment();
      tx.invoiceTransaction.findFirst.mockResolvedValue(existing);

      await expect(service.recordGatewayPayment(tx, input)).resolves.toEqual({
        transaction: existing,
        created: false,
      });
      expect(tx.invoiceTransaction.create).not.toHaveBeenCalled();
    });
  });

  describe('applyBalance', () => {
    it('stores the status, the payment that settled and the net received', async () => {
      await service.applyBalance(tx, 'inv-1');

      expect(tx.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: {
          status: 'PAID',
          paidAt,
          paidMethod: 'PIX',
          paidValue: 100,
          excessValue: 0,
        },
      });
    });

    it('stores the excess of a duplicate payment', async () => {
      tx.invoice.findUniqueOrThrow.mockResolvedValue(
        invoice({
          status: 'PAID',
          transactions: [
            payment(),
            payment({
              id: 'tx-slip',
              method: 'BANK_SLIP',
              chargeId: 'charge-slip',
              occurredAt: new Date('2026-10-17T00:00:00Z'),
            }),
          ],
        }),
      );

      await expect(service.applyBalance(tx, 'inv-1')).resolves.toEqual({
        status: 'PAID',
        paidEvent: null,
      });
      expect(tx.invoice.update.mock.calls[0][0].data).toMatchObject({
        paidMethod: 'PIX',
        paidValue: 200,
        excessValue: 100,
      });
    });

    it('does not touch a cancelled invoice', async () => {
      tx.invoice.findUniqueOrThrow.mockResolvedValue(
        invoice({ status: 'CANCELLED' }),
      );

      await expect(service.applyBalance(tx, 'inv-1')).resolves.toEqual({
        status: 'CANCELLED',
        paidEvent: null,
      });
      expect(tx.invoice.update).not.toHaveBeenCalled();
    });

    it('does not recalculate an invoice paid before the charges', async () => {
      tx.invoice.findUniqueOrThrow.mockResolvedValue(
        invoice({ status: 'PAID', transactions: [] }),
      );

      await expect(service.applyBalance(tx, 'inv-1')).resolves.toEqual({
        status: 'PAID',
        paidEvent: null,
      });
      expect(tx.invoice.update).not.toHaveBeenCalled();
    });

    it('returns the paid event only when the invoice becomes paid', async () => {
      await expect(service.applyBalance(tx, 'inv-1')).resolves.toEqual({
        status: 'PAID',
        paidEvent: {
          invoiceId: 'inv-1',
          organizationId: 'org-1',
          transactionId: 'tx-pix',
          chargeId: 'charge-pix',
          method: 'PIX',
          paidAt: '2026-10-16T00:00:00.000Z',
          paidValue: 100,
        },
      });

      tx.invoice.findUniqueOrThrow.mockResolvedValue(
        invoice({ status: 'PAID' }),
      );

      await expect(service.applyBalance(tx, 'inv-1')).resolves.toMatchObject({
        paidEvent: null,
      });
    });

    it('goes back to pending when the payment that settled is cancelled', async () => {
      tx.invoice.findUniqueOrThrow.mockResolvedValue(
        invoice({
          status: 'PAID',
          transactions: [payment({ source: 'OPERATOR', status: 'CANCELLED' })],
        }),
      );

      await expect(service.applyBalance(tx, 'inv-1')).resolves.toEqual({
        status: 'PENDING',
        paidEvent: null,
      });
      expect(tx.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: {
          status: 'PENDING',
          paidAt: null,
          paidMethod: null,
          paidValue: null,
          excessValue: 0,
        },
      });
    });

    it('awaits the confirmation while a proof sent by the payer is not reviewed', async () => {
      const proof = payment({
        id: 'tx-proof',
        source: 'CHECKOUT',
        status: 'PENDING_REVIEW',
        method: 'BANK_TRANSFER',
        amount: null,
        occurredAt: null,
        chargeId: null,
      });

      tx.invoice.findUniqueOrThrow.mockResolvedValue(
        invoice({ status: 'OVERDUE', transactions: [proof] }),
      );

      await expect(service.applyBalance(tx, 'inv-1')).resolves.toEqual({
        status: 'AWAITING_CONFIRMATION',
        paidEvent: null,
      });
      expect(tx.invoice.update.mock.calls[0][0].data).toMatchObject({
        status: 'AWAITING_CONFIRMATION',
        paidAt: null,
        paidValue: null,
      });

      // Um pagamento confirmado que ainda não cobre a fatura não muda isso
      tx.invoice.findUniqueOrThrow.mockResolvedValue(
        invoice({
          status: 'AWAITING_CONFIRMATION',
          transactions: [
            payment({
              source: 'OPERATOR',
              method: 'BANK_TRANSFER',
              amount: new Prisma.Decimal(40),
              chargeId: null,
            }),
            proof,
          ],
        }),
      );

      await expect(service.applyBalance(tx, 'inv-1')).resolves.toMatchObject({
        status: 'AWAITING_CONFIRMATION',
      });
    });

    it('is paid even with another proof waiting when the confirmed payments settle it', async () => {
      tx.invoice.findUniqueOrThrow.mockResolvedValue(
        invoice({
          status: 'AWAITING_CONFIRMATION',
          transactions: [
            payment({ source: 'OPERATOR', method: 'PIX', chargeId: null }),
            payment({
              id: 'tx-proof',
              source: 'CHECKOUT',
              status: 'PENDING_REVIEW',
              amount: null,
              occurredAt: null,
              chargeId: null,
            }),
          ],
        }),
      );

      await expect(service.applyBalance(tx, 'inv-1')).resolves.toMatchObject({
        status: 'PAID',
        paidEvent: { transactionId: 'tx-pix', chargeId: null },
      });
    });

    it('goes back to pending when the last proof is rejected', async () => {
      tx.invoice.findUniqueOrThrow.mockResolvedValue(
        invoice({
          status: 'AWAITING_CONFIRMATION',
          transactions: [
            payment({
              source: 'CHECKOUT',
              status: 'REJECTED',
              amount: null,
              occurredAt: null,
              chargeId: null,
            }),
          ],
        }),
      );

      await expect(service.applyBalance(tx, 'inv-1')).resolves.toMatchObject({
        status: 'PENDING',
      });
    });

    it('keeps an overdue invoice overdue while it is not settled', async () => {
      tx.invoice.findUniqueOrThrow.mockResolvedValue(
        invoice({
          status: 'OVERDUE',
          transactions: [payment({ source: 'OPERATOR', status: 'CANCELLED' })],
        }),
      );

      await expect(service.applyBalance(tx, 'inv-1')).resolves.toMatchObject({
        status: 'OVERDUE',
      });
    });
  });
});
