import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CheckoutService } from './checkout.service.js';
import { PaymentProviderError } from '../payments/providers/payment-provider.js';
import { InvoiceTransactionsService } from '../payments/transactions/invoice-transactions.service.js';

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

const TOKEN = 'a'.repeat(32);

const BANK_ACCOUNT = {
  organizationId: 'org-1',
  bankCode: '341',
  bankName: 'Itaú',
  branch: '0001',
  accountNumber: '12345-6',
  accountType: 'CHECKING',
  holderName: 'Empresa Ltda',
  holderDocument: '11222333000181',
  pixKeyType: 'CNPJ',
  pixKey: '11222333000181',
  updatedAt: new Date('2026-10-01T12:00:00Z'),
};

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
    organization: {
      name: 'Empresa',
      logo: null,
      wallpaper: null,
      backgroundColor: null,
      buttonColor: null,
      bankTransferEnabled: false,
      pixMode: 'AUTOMATIC',
      bankAccount: null,
    },
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
    transactions: [] as any[],
    ...overrides,
  };
}

/** Transferência e PIX manual liberados, com a conta e a chave cadastradas. */
function manualInvoice(
  organization: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
) {
  return buildInvoice({
    paymentMethods: ['BANK_SLIP', 'PIX', 'BANK_TRANSFER', 'CREDIT_CARD'],
    organization: {
      ...buildInvoice().organization,
      bankTransferEnabled: true,
      pixMode: 'MANUAL',
      bankAccount: BANK_ACCOUNT,
      ...organization,
    },
    ...overrides,
  });
}

let sequence = 0;

/** Transação como lida pelo checkout (saldo e comprovantes). */
function transaction(overrides: Record<string, unknown> = {}) {
  sequence += 1;

  return {
    id: `tx-${sequence}`,
    type: 'PAYMENT',
    status: 'PENDING_REVIEW',
    source: 'CHECKOUT',
    method: 'BANK_TRANSFER',
    amount: null,
    occurredAt: null,
    createdAt: new Date(Date.UTC(2026, 9, 14, 12, 0, sequence)),
    chargeId: null,
    statusReason: null,
    proofName: 'comprovante.pdf',
    proofKey: `organizations/org-1/invoices/inv-1/tx-${sequence}.pdf`,
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
  let storage: any;
  let eventEmitter: any;
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

  const findTransaction = ({ where }: any) =>
    invoice.transactions.find(
      (row: any) =>
        row.id === where.id && (!where.source || row.source === where.source),
    ) ?? null;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));

    invoice = buildInvoice();
    prisma = {
      invoice: { findUnique: vi.fn().mockImplementation(() => invoice) },
      invoiceTransaction: {
        findFirst: vi
          .fn()
          .mockImplementation(async (args) => findTransaction(args)),
      },
    };
    // Banco em memória: a fatura e as transações dela
    tx = {
      invoice: {
        findUniqueOrThrow: vi.fn().mockImplementation(() => invoice),
        update: vi
          .fn()
          .mockImplementation(async ({ data }: any) =>
            Object.assign(invoice, data),
          ),
      },
      invoiceTransaction: {
        create: vi.fn().mockImplementation(async ({ data }: any) => {
          invoice.transactions.push({
            ...data,
            createdAt: new Date(),
            chargeId: null,
            statusReason: null,
          });

          return data;
        }),
        findFirst: vi
          .fn()
          .mockImplementation(async (args) => findTransaction(args)),
        delete: vi.fn().mockImplementation(async ({ where }: any) => {
          invoice.transactions = invoice.transactions.filter(
            (row: any) => row.id !== where.id,
          );
        }),
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
      markPaid: vi.fn().mockResolvedValue(null),
    };
    storage = {
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      getSignedUrl: vi.fn().mockResolvedValue('https://r2.test/signed'),
    };
    eventEmitter = { emit: vi.fn() };

    service = new CheckoutService(
      prisma,
      routing,
      charges,
      new InvoiceTransactionsService(),
      storage,
      eventEmitter,
    );
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
          mode: 'AUTOMATIC',
          quote: expect.objectContaining({
            total: 98.01,
            methodDiscount: 0.99,
            discountUntil: '2026-10-30',
          }),
          pix: null,
        },
      ]);
      expect(view).toMatchObject({
        receipts: [],
        balance: { due: null, received: 0, balance: null },
        lockedMethod: null,
      });
    });

    it('shows the issuer and only the name of the customer', async () => {
      const view: any = await service.getView(TOKEN);

      expect(view).toMatchObject({
        status: 'PENDING',
        issuer: { name: 'Empresa', logo: null },
        theme: { wallpaper: null, backgroundColor: null, buttonColor: null },
        customerName: 'Cliente',
        dueDate: '2026-10-31',
        items: [
          {
            name: 'Produto',
            quantity: 1,
            total: 100,
            discount: 1,
            promotionName: null,
          },
        ],
      });
      expect(JSON.stringify(view)).not.toContain('12345678909');
      expect(JSON.stringify(view)).not.toContain('cliente@email.com');
    });

    it('names the promotion of an item discount', async () => {
      invoice.items = [
        { ...invoice.items[0], price: 100, quantity: 10, total: 1000 },
      ];
      invoice.discount = {
        items: [
          {
            id: 'item-1',
            type: 'FIXED',
            value: 20,
            promotion: {
              id: 'promo-1',
              name: 'Natal',
              application: 'UNIT',
              maxAmount: null,
              maxQuantity: 3,
            },
          },
        ],
        methods: [],
      };

      const view: any = await service.getView(TOKEN);

      expect(view.items).toEqual([
        {
          name: 'Produto',
          quantity: 10,
          total: 1000,
          discount: 60,
          promotionName: 'Natal',
        },
      ]);
    });

    it('applies the customization of the organization', async () => {
      invoice.organization = {
        ...invoice.organization,
        name: 'Empresa',
        logo: 'https://api.fature/logos/org-1?v=1',
        wallpaper: 'WAVES',
        backgroundColor: '#9db4dc',
        buttonColor: '#5b3fd1',
      };

      const view = await service.getView(TOKEN);

      expect(view.issuer).toEqual({
        name: 'Empresa',
        logo: 'https://api.fature/logos/org-1?v=1',
      });
      expect(view.theme).toEqual({
        wallpaper: 'WAVES',
        backgroundColor: '#9db4dc',
        buttonColor: '#5b3fd1',
      });
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

  describe('manual payment options', () => {
    it('offers the PIX with the key of the company and the bank transfer, for free', async () => {
      invoice = manualInvoice();

      const view = await service.getView(TOKEN);

      expect(view.options.map((option) => option.method)).toEqual([
        'BANK_SLIP',
        'CREDIT_CARD',
        'PIX',
        'BANK_TRANSFER',
      ]);
      expect(view.options[2]).toEqual({
        method: 'PIX',
        mode: 'MANUAL',
        quote: expect.objectContaining({ total: 98.01 }),
        manualPix: {
          keyType: 'CNPJ',
          key: '11222333000181',
          holderName: 'Empresa Ltda',
          value: 98.01,
          payload: expect.stringContaining('540598.01'),
          qrCodeImage: expect.stringMatching(/^iVBOR/),
        },
      });
      expect(view.options[2]).toMatchObject({
        manualPix: {
          payload: expect.stringContaining('011411222333000181'),
        },
      });
      expect(view.options[3]).toEqual({
        method: 'BANK_TRANSFER',
        quote: expect.objectContaining({ total: 99 }),
        bankTransfer: {
          bankCode: '341',
          bankName: 'Itaú',
          branch: '0001',
          accountNumber: '12345-6',
          accountType: 'CHECKING',
          holderName: 'Empresa Ltda',
          holderDocument: '11222333000181',
          value: 99,
        },
      });
      expect(charges.createCharge).not.toHaveBeenCalled();
    });

    it('uses the name of the company in the PIX without a holder', async () => {
      invoice = manualInvoice({
        bankTransferEnabled: false,
        bankAccount: { ...BANK_ACCOUNT, holderName: null },
      });

      const view = await service.getView(TOKEN);
      const pixOption: any = view.options.find((o) => o.method === 'PIX');

      expect(pixOption.manualPix.holderName).toBe('Empresa');
      expect(pixOption.manualPix.payload).toContain('5907Empresa');
    });

    it('hides the manual PIX without a key, and never falls back to the provider', async () => {
      invoice = manualInvoice({
        bankAccount: { ...BANK_ACCOUNT, pixKeyType: null, pixKey: null },
      });

      const view = await service.getView(TOKEN);

      expect(view.options.map((option) => option.method)).toEqual([
        'BANK_SLIP',
        'CREDIT_CARD',
        'BANK_TRANSFER',
      ]);
    });

    it('hides the bank transfer with incomplete data or when it is not released', async () => {
      invoice = manualInvoice({
        bankAccount: { ...BANK_ACCOUNT, holderDocument: null },
      });

      await expect(service.getView(TOKEN)).resolves.toMatchObject({
        options: expect.not.arrayContaining([
          expect.objectContaining({ method: 'BANK_TRANSFER' }),
        ]),
      });

      invoice = manualInvoice({ bankTransferEnabled: false });

      const view = await service.getView(TOKEN);

      expect(view.options.map((option) => option.method)).not.toContain(
        'BANK_TRANSFER',
      );
    });

    it('offers only the locked method, for the balance that is left', async () => {
      invoice = manualInvoice(
        {},
        {
          transactions: [
            transaction({
              status: 'CONFIRMED',
              source: 'OPERATOR',
              method: 'PIX',
              amount: new Prisma.Decimal(50),
              occurredAt: new Date('2026-10-14T00:00:00Z'),
            }),
          ],
        },
      );

      const view = await service.getView(TOKEN);

      expect(view.options).toHaveLength(1);
      expect(view.options[0]).toMatchObject({
        method: 'PIX',
        mode: 'MANUAL',
        quote: { total: 98.01 },
        manualPix: { value: 48.01 },
      });
      expect(view).toMatchObject({
        lockedMethod: 'PIX',
        balance: { due: 98.01, received: 50, balance: 48.01 },
      });
    });

    it('offers the value of the day while the locked method only has proofs to review', async () => {
      invoice = manualInvoice(
        {},
        { status: 'AWAITING_CONFIRMATION', transactions: [transaction()] },
      );

      const view = await service.getView(TOKEN);

      expect(view.status).toBe('AWAITING_CONFIRMATION');
      expect(view.options).toEqual([
        expect.objectContaining({
          method: 'BANK_TRANSFER',
          bankTransfer: expect.objectContaining({ value: 99 }),
        }),
      ]);
    });

    it('offers nothing when the locked method is no longer available', async () => {
      invoice = manualInvoice(
        { bankTransferEnabled: false },
        { transactions: [transaction()] },
      );

      await expect(service.getView(TOKEN)).resolves.toMatchObject({
        options: [],
        lockedMethod: 'BANK_TRANSFER',
      });
    });

    it('lists the receipts with the reason of the rejection only', async () => {
      invoice = manualInvoice(
        {},
        {
          transactions: [
            transaction({
              status: 'REJECTED',
              statusReason: 'Valor diferente da fatura',
            }),
            transaction({
              status: 'CANCELLED',
              source: 'OPERATOR',
              method: 'PIX',
              amount: new Prisma.Decimal(20),
              occurredAt: new Date('2026-10-14T00:00:00Z'),
              statusReason: 'Lançado na fatura errada',
            }),
          ],
        },
      );

      const { receipts } = await service.getView(TOKEN);

      expect(receipts).toEqual([
        {
          id: expect.any(String),
          method: 'BANK_TRANSFER',
          status: 'REJECTED',
          amount: null,
          occurredAt: null,
          statusReason: 'Valor diferente da fatura',
          fileName: 'comprovante.pdf',
          createdAt: expect.any(String),
        },
        expect.objectContaining({
          status: 'CANCELLED',
          amount: 20,
          occurredAt: '2026-10-14',
          // O motivo do cancelamento é interno, e o arquivo da empresa não abre no checkout
          statusReason: null,
          fileName: null,
        }),
      ]);
    });

    it('never lists the payments of the provider as receipts', async () => {
      invoice = buildInvoice({
        status: 'PAID',
        transactions: [
          transaction({
            status: 'CONFIRMED',
            source: 'GATEWAY',
            method: 'PIX',
            amount: new Prisma.Decimal(98.01),
            occurredAt: new Date('2026-10-14T00:00:00Z'),
            chargeId: 'charge-pix',
            proofName: null,
            proofKey: null,
          }),
        ],
      });

      await expect(service.getView(TOKEN)).resolves.toMatchObject({
        receipts: [],
      });
    });
  });

  describe('uploadReceipt', () => {
    const file = {
      buffer: Buffer.from('%PDF'),
      mimetype: 'application/pdf',
      originalname: 'C:\\fakepath\\ted.pdf',
      size: 4,
    };

    beforeEach(() => {
      invoice = manualInvoice();
    });

    it('records the proof awaiting review and leaves the invoice awaiting confirmation', async () => {
      const order: string[] = [];

      charges.withInvoiceLock.mockImplementation(
        async (_id: string, work: any) => {
          const result = await work(tx);

          order.push('commit');

          return result;
        },
      );
      eventEmitter.emit.mockImplementation(() => order.push('emit'));

      const view = await service.uploadReceipt(TOKEN, 'BANK_TRANSFER', file);
      const { data } = tx.invoiceTransaction.create.mock.calls[0][0];

      expect(storage.put).toHaveBeenCalledWith(
        `organizations/org-1/invoices/inv-1/${data.id}.pdf`,
        file.buffer,
        'application/pdf',
      );
      expect(data).toMatchObject({
        invoiceId: 'inv-1',
        type: 'PAYMENT',
        method: 'BANK_TRANSFER',
        amount: null,
        occurredAt: null,
        status: 'PENDING_REVIEW',
        source: 'CHECKOUT',
        proofName: 'ted.pdf',
        proofMimeType: 'application/pdf',
      });
      expect(invoice.status).toBe('AWAITING_CONFIRMATION');
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'invoice.payment-proof.received',
        { invoiceId: 'inv-1', organizationId: 'org-1', transactionId: data.id },
      );
      expect(order).toEqual(['commit', 'emit']);
      // Daqui em diante, o checkout só aceita a transferência
      expect(view).toMatchObject({
        status: 'AWAITING_CONFIRMATION',
        lockedMethod: 'BANK_TRANSFER',
        receipts: [{ id: data.id, status: 'PENDING_REVIEW' }],
      });
      expect(view.options.map((option) => option.method)).toEqual([
        'BANK_TRANSFER',
      ]);
    });

    it('accepts other proofs of the same method', async () => {
      invoice.transactions = [transaction()];

      await service.uploadReceipt(TOKEN, 'BANK_TRANSFER', file);

      expect(invoice.transactions).toHaveLength(2);
    });

    it('refuses a proof of another method once the invoice is locked', async () => {
      invoice.transactions = [transaction()];

      const error = await service
        .uploadReceipt(TOKEN, 'PIX', file)
        .catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as Error).message).toBe(
        'Esta fatura está sendo paga por Transferência bancária. Envie o comprovante dessa forma.',
      );
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('refuses a method that is not enabled in the invoice or not released', async () => {
      invoice = manualInvoice({}, { paymentMethods: ['PIX'] });

      await expect(
        service.uploadReceipt(TOKEN, 'BANK_TRANSFER', file),
      ).rejects.toBeInstanceOf(BadRequestException);

      invoice = manualInvoice({ bankTransferEnabled: false });

      await expect(
        service.uploadReceipt(TOKEN, 'BANK_TRANSFER', file),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('limits the proofs awaiting review', async () => {
      invoice.transactions = Array.from({ length: 10 }, () => transaction());

      await expect(
        service.uploadReceipt(TOKEN, 'BANK_TRANSFER', file),
      ).rejects.toThrow('Aguarde a conferência dos comprovantes enviados.');
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('refuses an invoice that is already paid', async () => {
      invoice = manualInvoice({}, { status: 'PAID' });

      await expect(
        service.uploadReceipt(TOKEN, 'BANK_TRANSFER', file),
      ).rejects.toThrow('Esta fatura já foi paga');
    });

    it('checks again inside the lock and deletes the uploaded file on failure', async () => {
      tx.invoice.findUniqueOrThrow.mockImplementationOnce(() =>
        manualInvoice({}, { status: 'CANCELLED' }),
      );

      await expect(
        service.uploadReceipt(TOKEN, 'BANK_TRANSFER', file),
      ).rejects.toThrow('Esta fatura foi cancelada');

      expect(storage.delete).toHaveBeenCalledWith(storage.put.mock.calls[0][0]);
      expect(tx.invoiceTransaction.create).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('removeReceipt', () => {
    it('removes a proof not reviewed yet and its file', async () => {
      const proof = transaction();

      invoice = manualInvoice(
        {},
        { status: 'AWAITING_CONFIRMATION', transactions: [proof] },
      );

      const view = await service.removeReceipt(TOKEN, proof.id);

      expect(tx.invoiceTransaction.delete).toHaveBeenCalledWith({
        where: { id: proof.id },
      });
      expect(invoice.status).toBe('PENDING');
      expect(storage.delete).toHaveBeenCalledWith(proof.proofKey);
      expect(view.receipts).toEqual([]);
    });

    it('keeps the proof that was already reviewed', async () => {
      const reviewed = transaction({
        status: 'CONFIRMED',
        amount: new Prisma.Decimal(50),
        occurredAt: new Date('2026-10-14T00:00:00Z'),
      });

      invoice = manualInvoice({}, { transactions: [reviewed] });

      await expect(service.removeReceipt(TOKEN, reviewed.id)).rejects.toThrow(
        'Este comprovante já foi conferido e não pode ser removido.',
      );
      expect(tx.invoiceTransaction.delete).not.toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('does not remove a payment registered by the company', async () => {
      const registered = transaction({ source: 'OPERATOR' });

      invoice = manualInvoice({}, { transactions: [registered] });

      await expect(
        service.removeReceipt(TOKEN, registered.id),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('does not find a proof of another invoice', async () => {
      await expect(
        service.removeReceipt(TOKEN, 'tx-other'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('keeps the removal when the file cannot be deleted', async () => {
      const proof = transaction();

      invoice = manualInvoice({}, { transactions: [proof] });
      storage.delete.mockRejectedValue(new Error('r2 down'));

      await expect(
        service.removeReceipt(TOKEN, proof.id),
      ).resolves.toMatchObject({ receipts: [] });
    });
  });

  describe('receiptFileUrl', () => {
    it('signs the URL of a proof sent by the payer', async () => {
      const proof = transaction({ proofMimeType: 'application/pdf' });

      invoice = manualInvoice({}, { transactions: [proof] });

      await expect(service.receiptFileUrl(TOKEN, proof.id)).resolves.toBe(
        'https://r2.test/signed',
      );
      expect(prisma.invoiceTransaction.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: proof.id, invoiceId: 'inv-1', source: 'CHECKOUT' },
        }),
      );
    });

    it('does not open the file of the company', async () => {
      const registered = transaction({ source: 'OPERATOR' });

      invoice = manualInvoice({}, { transactions: [registered] });

      await expect(
        service.receiptFileUrl(TOKEN, registered.id),
      ).rejects.toBeInstanceOf(NotFoundException);
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

    it('never generates the PIX of the provider in the manual mode', async () => {
      invoice = manualInvoice({
        bankAccount: { ...BANK_ACCOUNT, pixKeyType: null, pixKey: null },
      });

      const error = await service
        .createPix(TOKEN)
        .catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toBe(
        'O PIX desta fatura é pago com a chave da empresa e o envio do comprovante.',
      );
      expect(charges.withInvoiceLock).not.toHaveBeenCalled();
    });

    it('refuses the PIX of the provider on an invoice paid by bank transfer', async () => {
      invoice = buildInvoice({
        paymentMethods: ['PIX', 'BANK_TRANSFER'],
        transactions: [transaction()],
      });

      await expect(service.createPix(TOKEN)).rejects.toThrow(
        'Esta fatura está sendo paga por Transferência bancária. Envie o comprovante dessa forma.',
      );
      expect(charges.createCharge).not.toHaveBeenCalled();
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
        receiptUrl: null,
      });
    });

    it('emits the invoice paid event after the lock when the card is approved', async () => {
      const paidEvent = { invoiceId: 'inv-1', chargeId: 'charge-card' };
      const order: string[] = [];

      charges.createCharge.mockResolvedValue({
        record: { id: 'charge-card' },
        providerStatus: 'PAID',
      });
      charges.markPaid.mockResolvedValue(paidEvent);
      charges.withInvoiceLock.mockImplementation(
        async (_id: string, work: any) => {
          const result = await work(tx);

          order.push('commit');

          return result;
        },
      );
      eventEmitter.emit.mockImplementation(() => order.push('emit'));

      await service.payWithCreditCard(TOKEN, dto, '200.1.1.1');

      expect(eventEmitter.emit).toHaveBeenCalledWith('invoice.paid', paidEvent);
      expect(order).toEqual(['commit', 'emit']);
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
      expect(eventEmitter.emit).not.toHaveBeenCalled();
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

    it('refuses the card on an invoice already being paid with the key of the company', async () => {
      invoice = manualInvoice(
        {},
        {
          status: 'AWAITING_CONFIRMATION',
          transactions: [transaction({ method: 'PIX' })],
        },
      );

      await expect(
        service.payWithCreditCard(TOKEN, dto, '200.1.1.1'),
      ).rejects.toThrow(
        'Esta fatura está sendo paga por PIX. Envie o comprovante dessa forma.',
      );
      expect(charges.createCharge).not.toHaveBeenCalled();
    });
  });
});
