import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { InvoiceTransactionsService } from '../../payments/transactions/invoice-transactions.service.js';
import { InvoiceTransactionActionsService } from './invoice-transaction-actions.service.js';

// PrismaService abre o pool do banco ao ser importado; os testes usam mocks
vi.mock('../../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

function gatewayPayment(id: string, method: string, day: string) {
  return {
    id,
    type: 'PAYMENT',
    status: 'CONFIRMED',
    source: 'GATEWAY',
    method,
    amount: new Prisma.Decimal(100),
    occurredAt: new Date(`${day}T00:00:00Z`),
    createdAt: new Date(`${day}T12:00:00Z`),
    chargeId: `charge-${id}`,
  };
}

const withDecimal = (data: Record<string, any>) =>
  typeof data.amount === 'number'
    ? { ...data, amount: new Prisma.Decimal(data.amount) }
    : data;

describe('InvoiceTransactionActionsService', () => {
  const file = {
    buffer: Buffer.from('%PDF'),
    mimetype: 'application/pdf',
    originalname: 'ted.pdf',
    size: 4,
  };
  const fileSha256 = createHash('sha256').update(file.buffer).digest('hex');
  const refund = {
    type: 'REFUND' as const,
    method: 'BANK_TRANSFER' as const,
    amount: 100,
    occurredAt: '2026-10-15',
    bankReference: 'E2E123',
    notes: null,
  };

  /**
   * Banco em memória: a fatura paga duas vezes (PIX e boleto), com 100 de excedente; `others` são
   * pagamentos de outras faturas da organização (comprovante repetido).
   */
  let state: {
    invoice: Record<string, any>;
    transactions: any[];
    others: any[];
  };
  let tx: any;
  let prisma: any;
  let charges: any;
  let storage: any;
  let invoices: any;
  let eventEmitter: any;
  let service: InvoiceTransactionActionsService;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));

    state = {
      invoice: {
        id: 'inv-1',
        organizationId: 'org-1',
        status: 'PAID',
        items: [{ id: 'item-1', total: 100 }],
        dueDate: new Date('2026-10-31T00:00:00Z'),
        discount: null,
        interestAndFine: null,
        excessValue: 100,
        createdAt: new Date('2026-10-01T15:00:00Z'),
        paymentMethods: ['BANK_SLIP', 'PIX'],
        organization: {
          bankTransferEnabled: false,
          pixMode: 'AUTOMATIC',
          bankAccount: null,
        },
      },
      transactions: [
        gatewayPayment('pix', 'PIX', '2026-10-10'),
        gatewayPayment('slip', 'BANK_SLIP', '2026-10-11'),
      ],
      others: [],
    };

    const rowById = (id: string) =>
      state.transactions.find((row) => row.id === id);

    const findTransaction = async ({ where }: any) => {
      // Comprovante repetido: outro pagamento confirmado com a mesma referência ou o mesmo arquivo
      if (where.OR) {
        const sameInvoice = state.transactions.map((row) => ({
          ...row,
          invoice: {
            id: 'inv-1',
            dueDate: state.invoice.dueDate,
            client: { name: 'Maria' },
          },
        }));
        const match = [...sameInvoice, ...state.others].find(
          (row) =>
            row.id !== where.id.not &&
            row.status === where.status &&
            where.OR.some((condition: Record<string, unknown>) =>
              Object.entries(condition).every(
                ([field, value]) => row[field] === value,
              ),
            ),
        );

        return match ? { invoice: match.invoice } : null;
      }

      const row = rowById(where.id);

      return row
        ? { ...row, invoice: { createdAt: state.invoice.createdAt } }
        : null;
    };
    const loadInvoice = async () => ({
      ...state.invoice,
      transactions: state.transactions,
    });

    tx = {
      invoice: {
        findUniqueOrThrow: vi.fn(loadInvoice),
        update: vi.fn(async ({ data }: any) =>
          Object.assign(state.invoice, data),
        ),
      },
      invoiceTransaction: {
        create: vi.fn(async ({ data }: any) => {
          state.transactions.push({
            ...withDecimal(data),
            createdAt: new Date(),
            chargeId: null,
          });
          return data;
        }),
        findFirst: vi.fn(findTransaction),
        update: vi.fn(async ({ where, data }: any) =>
          Object.assign(rowById(where.id), withDecimal(data)),
        ),
      },
    };
    prisma = {
      invoice: { findFirst: vi.fn(loadInvoice) },
      invoiceTransaction: { findFirst: vi.fn(findTransaction) },
    };
    charges = {
      withInvoiceLock: vi.fn((_id: string, work: any) => work(tx)),
      cancelOpenCharges: vi.fn().mockResolvedValue(undefined),
    };
    storage = {
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      getSignedUrl: vi.fn().mockResolvedValue('https://r2.test/signed'),
    };
    invoices = { findOne: vi.fn().mockResolvedValue({ id: 'inv-1' }) };
    eventEmitter = { emit: vi.fn() };

    service = new InvoiceTransactionActionsService(
      prisma,
      charges,
      // Recebimentos do financeiro: cobertos em invoice-receipts.service.spec.ts
      new InvoiceTransactionsService({ sync: vi.fn() } as any),
      storage,
      invoices,
      eventEmitter,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('createByOperator', () => {
    const create = (dto: Partial<typeof refund> = {}) =>
      service.createByOperator(
        'org-1',
        'inv-1',
        'user-1',
        { ...refund, ...dto },
        file,
      );

    it('records the refund with the proof and returns the invoice detail', async () => {
      await expect(create()).resolves.toEqual({ id: 'inv-1' });

      const [key, body, contentType] = storage.put.mock.calls[0];
      const { data } = tx.invoiceTransaction.create.mock.calls[0][0];

      expect(key).toBe(`organizations/org-1/invoices/inv-1/${data.id}.pdf`);
      expect(body).toBe(file.buffer);
      expect(contentType).toBe('application/pdf');
      expect(data).toMatchObject({
        invoiceId: 'inv-1',
        type: 'REFUND',
        method: 'BANK_TRANSFER',
        amount: 100,
        occurredAt: new Date('2026-10-15T00:00:00Z'),
        status: 'CONFIRMED',
        source: 'OPERATOR',
        bankReference: 'E2E123',
        createdById: 'user-1',
        reviewedById: 'user-1',
        proofKey: key,
        proofName: 'ted.pdf',
      });
      // O excedente foi todo devolvido; a fatura continua paga
      expect(state.invoice).toMatchObject({ status: 'PAID', excessValue: 0 });
      expect(storage.delete).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
      expect(charges.cancelOpenCharges).not.toHaveBeenCalled();
    });

    it('does not find an invoice of another organization', async () => {
      prisma.invoice.findFirst.mockResolvedValue(null);

      await expect(create()).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('refuses a refund on an invoice that is not paid', async () => {
      state.invoice.status = 'PENDING';

      await expect(create()).rejects.toBeInstanceOf(ConflictException);
      expect(tx.invoiceTransaction.create).not.toHaveBeenCalled();
    });

    it('refuses a refund above the excess', async () => {
      const error = await create({ amount: 100.01 }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as Error).message).toMatch(
        /^A devolução não pode passar do excedente de R\$\s100,00\.$/,
      );
    });

    it('refuses a future date before uploading the file', async () => {
      await expect(create({ occurredAt: '2026-10-16' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('refuses a date before the invoice was issued', async () => {
      await expect(create({ occurredAt: '2026-09-30' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('deletes the uploaded file when the transaction fails', async () => {
      tx.invoiceTransaction.create.mockRejectedValue(new Error('db down'));

      await expect(create()).rejects.toThrow('db down');

      expect(storage.delete).toHaveBeenCalledWith(storage.put.mock.calls[0][0]);
    });

    it('keeps the original error when the file cannot be deleted', async () => {
      state.invoice.status = 'PENDING';
      storage.delete.mockRejectedValue(new Error('r2 down'));

      await expect(create()).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('cancel', () => {
    const cancel = (transactionId: string) =>
      service.cancel('org-1', 'inv-1', transactionId, 'user-1', 'Valor errado');

    it('does not cancel a transaction from the provider', async () => {
      await expect(cancel('pix')).rejects.toBeInstanceOf(ConflictException);
    });

    it('only cancels confirmed transactions', async () => {
      state.transactions.push({
        ...gatewayPayment('rejected', 'PIX', '2026-10-12'),
        source: 'CHECKOUT',
        status: 'REJECTED',
      });

      await expect(cancel('rejected')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('does not find a transaction of another invoice', async () => {
      await expect(cancel('missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('brings the excess back when a refund is cancelled', async () => {
      await service.createByOperator('org-1', 'inv-1', 'user-1', refund, file);
      const refundId = tx.invoiceTransaction.create.mock.calls[0][0].data.id;

      expect(state.invoice.excessValue).toBe(0);

      await expect(cancel(refundId)).resolves.toEqual({ id: 'inv-1' });

      expect(
        state.transactions.find((row) => row.id === refundId),
      ).toMatchObject({
        status: 'CANCELLED',
        statusReason: 'Valor errado',
        cancelledById: 'user-1',
      });
      expect(state.invoice).toMatchObject({ status: 'PAID', excessValue: 100 });
    });
  });

  describe('proofUrl', () => {
    it('signs the URL of the proof', async () => {
      state.transactions.push({
        id: 'refund',
        proofKey: 'organizations/org-1/invoices/inv-1/refund.pdf',
        proofMimeType: 'application/pdf',
        proofName: 'ted.pdf',
      });

      await expect(service.proofUrl('org-1', 'inv-1', 'refund')).resolves.toBe(
        'https://r2.test/signed',
      );
      expect(storage.getSignedUrl).toHaveBeenCalledWith(
        'organizations/org-1/invoices/inv-1/refund.pdf',
        { contentType: 'application/pdf', fileName: 'ted.pdf' },
      );
    });

    it('is not found without a proof', async () => {
      await expect(
        service.proofUrl('org-1', 'inv-1', 'pix'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  /** Fatura de 500 em aberto, com 10% de desconto no PIX até 20/10 e transferência liberada. */
  describe('manual payments', () => {
    const proof = (overrides: Record<string, unknown> = {}) => ({
      id: 'proof',
      type: 'PAYMENT',
      status: 'PENDING_REVIEW',
      source: 'CHECKOUT',
      method: 'PIX',
      amount: null,
      occurredAt: null,
      createdAt: new Date('2026-10-14T12:00:00Z'),
      chargeId: null,
      bankReference: null,
      proofSha256: 'sha-proof',
      ...overrides,
    });
    const confirmed = (overrides: Record<string, unknown> = {}) => ({
      ...proof(),
      id: 'confirmed',
      status: 'CONFIRMED',
      source: 'OPERATOR',
      amount: new Prisma.Decimal(300),
      occurredAt: new Date('2026-10-14T00:00:00Z'),
      createdAt: new Date('2026-10-14T10:00:00Z'),
      proofSha256: 'sha-confirmed',
      ...overrides,
    });
    const confirmDto = (overrides: Record<string, unknown> = {}) => ({
      amount: 300,
      occurredAt: '2026-10-14',
      bankReference: null,
      notes: null,
      ...overrides,
    });
    const confirm = (overrides: Record<string, unknown> = {}) =>
      service.confirm(
        'org-1',
        'inv-1',
        'proof',
        'user-1',
        confirmDto(overrides),
      );

    beforeEach(() => {
      state.invoice = {
        ...state.invoice,
        status: 'AWAITING_CONFIRMATION',
        items: [{ id: 'item-1', total: 500 }],
        discount: {
          items: [],
          methods: [
            {
              method: 'PIX',
              type: 'PERCENTAGE',
              value: 10,
              limitDate: '2026-10-20',
            },
          ],
        },
        excessValue: 0,
        paymentMethods: ['BANK_SLIP', 'PIX', 'BANK_TRANSFER'],
        organization: {
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
        },
      };
      state.transactions = [proof()];
    });

    describe('confirm', () => {
      it('goes back to pending and warns the payer when the amount does not cover the invoice', async () => {
        await expect(confirm()).resolves.toEqual({ id: 'inv-1' });

        expect(state.transactions[0]).toMatchObject({
          status: 'CONFIRMED',
          occurredAt: new Date('2026-10-14T00:00:00Z'),
          reviewedById: 'user-1',
          reviewedAt: expect.any(Date),
        });
        expect(state.transactions[0].amount.toNumber()).toBe(300);
        expect(state.invoice.status).toBe('PENDING');
        expect(charges.cancelOpenCharges).not.toHaveBeenCalled();
        expect(eventEmitter.emit).toHaveBeenCalledWith(
          'invoice.partially-paid',
          {
            invoiceId: 'inv-1',
            organizationId: 'org-1',
            transactionId: 'proof',
          },
        );
      });

      it('pays the invoice, cancels the bank slip and sends the payment email when the parts reach the amount', async () => {
        state.transactions.unshift(confirmed());

        await confirm({ amount: 150, occurredAt: '2026-10-15' });

        // 300 em 14/10 e 150 em 15/10: quita pelo valor com desconto (450)
        expect(state.invoice).toMatchObject({
          status: 'PAID',
          paidMethod: 'PIX',
          paidValue: 450,
          excessValue: 0,
        });
        expect(charges.cancelOpenCharges).toHaveBeenCalledWith(
          tx,
          'inv-1',
          null,
        );
        expect(eventEmitter.emit).toHaveBeenCalledWith(
          'invoice.paid',
          expect.objectContaining({
            invoiceId: 'inv-1',
            transactionId: 'proof',
            chargeId: null,
            method: 'PIX',
            paidValue: 450,
          }),
        );
        expect(eventEmitter.emit).not.toHaveBeenCalledWith(
          'invoice.partially-paid',
          expect.anything(),
        );
      });

      it('records the excess of a payment above the amount of the day', async () => {
        await confirm({ amount: 600 });

        expect(state.invoice).toMatchObject({
          status: 'PAID',
          paidValue: 600,
          excessValue: 150,
        });
      });

      it('keeps the invoice awaiting confirmation while another proof is pending', async () => {
        state.transactions.push(
          proof({ id: 'proof-2', createdAt: new Date('2026-10-15T09:00:00Z') }),
        );

        await confirm();

        expect(state.invoice.status).toBe('AWAITING_CONFIRMATION');
        expect(eventEmitter.emit).not.toHaveBeenCalled();
      });

      it('warns about a proof already used in another invoice', async () => {
        state.others.push({
          id: 'other',
          status: 'CONFIRMED',
          bankReference: 'E2E-OTHER',
          proofSha256: 'sha-proof',
          invoice: {
            id: 'inv-2',
            dueDate: new Date('2026-10-10T00:00:00Z'),
            client: { name: 'João' },
          },
        });

        const error = await confirm().catch((reason: unknown) => reason);

        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toEqual({
          message:
            'Este comprovante já foi usado na fatura de João com vencimento em 10/10/2026. Confirme de novo se a mesma transferência pagou as duas faturas.',
          details: ['DUPLICATE_PAYMENT_PROOF'],
        });
        expect(state.transactions[0].status).toBe('PENDING_REVIEW');

        await confirm({ acknowledgeDuplicates: true });

        expect(state.transactions[0].status).toBe('CONFIRMED');
      });

      it('warns about a bank reference already confirmed', async () => {
        state.transactions.unshift(
          confirmed({
            bankReference: 'E2E123',
            amount: new Prisma.Decimal(10),
          }),
        );

        await expect(
          confirm({ bankReference: 'E2E123' }),
        ).rejects.toBeInstanceOf(ConflictException);
        await expect(
          confirm({ bankReference: 'E2E456' }),
        ).resolves.toBeDefined();
      });

      it('refuses a proof that was already reviewed', async () => {
        state.transactions = [proof({ status: 'REJECTED' })];

        await expect(confirm()).rejects.toThrow(
          'Este comprovante já foi conferido.',
        );
        expect(tx.invoiceTransaction.update).not.toHaveBeenCalled();
      });

      it('refuses a future date', async () => {
        await expect(
          confirm({ occurredAt: '2026-10-16' }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('does not find a proof of another invoice', async () => {
        await expect(
          service.confirm('org-1', 'inv-1', 'missing', 'user-1', confirmDto()),
        ).rejects.toBeInstanceOf(NotFoundException);
      });
    });

    describe('reject', () => {
      const reject = () =>
        service.reject(
          'org-1',
          'inv-1',
          'proof',
          'user-1',
          'Comprovante ilegível',
        );

      it('rejects the proof with the reason and warns the payer', async () => {
        await expect(reject()).resolves.toEqual({ id: 'inv-1' });

        expect(state.transactions[0]).toMatchObject({
          status: 'REJECTED',
          statusReason: 'Comprovante ilegível',
          reviewedById: 'user-1',
        });
        expect(state.invoice.status).toBe('PENDING');
        expect(eventEmitter.emit).toHaveBeenCalledWith(
          'invoice.payment-proof.rejected',
          {
            invoiceId: 'inv-1',
            organizationId: 'org-1',
            transactionId: 'proof',
          },
        );
      });

      it('refuses a proof that was already reviewed', async () => {
        state.transactions = [confirmed({ id: 'proof' })];

        await expect(reject()).rejects.toBeInstanceOf(ConflictException);
        expect(eventEmitter.emit).not.toHaveBeenCalled();
      });
    });

    describe('createByOperator', () => {
      const payment = {
        type: 'PAYMENT' as const,
        method: 'BANK_TRANSFER' as const,
        amount: 500,
        occurredAt: '2026-10-15',
        bankReference: null,
        notes: 'Recebido por fora',
      };
      const register = (dto: Record<string, unknown> = {}) =>
        service.createByOperator(
          'org-1',
          'inv-1',
          'user-1',
          { ...payment, ...dto },
          file,
        );

      beforeEach(() => {
        state.invoice.status = 'PENDING';
        state.transactions = [];
      });

      it('registers a payment received by other means, already confirmed', async () => {
        await register();

        expect(
          tx.invoiceTransaction.create.mock.calls[0][0].data,
        ).toMatchObject({
          type: 'PAYMENT',
          method: 'BANK_TRANSFER',
          amount: 500,
          status: 'CONFIRMED',
          source: 'OPERATOR',
          notes: 'Recebido por fora',
          proofSha256: fileSha256,
        });
        expect(state.invoice).toMatchObject({
          status: 'PAID',
          paidMethod: 'BANK_TRANSFER',
        });
        expect(charges.cancelOpenCharges).toHaveBeenCalledWith(
          tx,
          'inv-1',
          null,
        );
        expect(eventEmitter.emit).toHaveBeenCalledWith(
          'invoice.paid',
          expect.objectContaining({ method: 'BANK_TRANSFER' }),
        );
      });

      it('refuses another method once the invoice is locked', async () => {
        state.transactions = [proof()];
        state.invoice.status = 'AWAITING_CONFIRMATION';

        await expect(register()).rejects.toThrow(
          'Esta fatura está sendo paga por PIX. Envie o comprovante dessa forma.',
        );
        expect(storage.put).not.toHaveBeenCalled();
      });

      it('refuses a method that is not released for the organization', async () => {
        state.invoice.organization = {
          ...state.invoice.organization,
          bankTransferEnabled: false,
        };

        await expect(register()).rejects.toBeInstanceOf(BadRequestException);
      });

      it('refuses an invoice that does not accept payment', async () => {
        state.invoice.status = 'PAID';

        await expect(register()).rejects.toThrow(
          'Esta fatura não aceita pagamento.',
        );
      });

      it('warns before uploading a file already used in a confirmed payment', async () => {
        state.others.push({
          id: 'other',
          status: 'CONFIRMED',
          bankReference: null,
          proofSha256: fileSha256,
          invoice: {
            id: 'inv-2',
            dueDate: new Date('2026-10-10T00:00:00Z'),
            client: { name: 'João' },
          },
        });

        await expect(register()).rejects.toMatchObject({
          response: { details: ['DUPLICATE_PAYMENT_PROOF'] },
        });
        expect(storage.put).not.toHaveBeenCalled();

        await register({ acknowledgeDuplicates: true });

        expect(state.invoice.status).toBe('PAID');
      });
    });
  });
});
