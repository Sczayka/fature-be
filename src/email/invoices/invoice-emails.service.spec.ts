import {
  ConflictException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EMAIL_SOURCE, EMAIL_TYPE } from '../email.constants.js';
import {
  InvoiceEmailsService,
  automaticDedupeKey,
  paidDate,
} from './invoice-emails.service.js';

// PrismaService abre o pool do banco ao ser importado; os testes usam mocks
vi.mock('../../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

const TODAY = '2026-10-18';

function buildInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    organizationId: 'org-1',
    clientId: 'client-1',
    status: 'PENDING',
    items: [{ id: 'item-1', name: 'Consultoria', quantity: 1, total: 100 }],
    totalValue: 100,
    dueDate: new Date('2026-10-21T00:00:00Z'),
    description: 'Mensalidade',
    paymentMethods: ['BANK_SLIP', 'PIX'],
    discount: {
      items: [],
      methods: [{ method: 'PIX', type: 'PERCENTAGE', value: 5, limitDate: '' }],
    },
    interestAndFine: {
      fineType: 'PERCENTAGE',
      fineValue: 2,
      interestType: 'PERCENTAGE',
      interestValue: 1,
    },
    checkoutToken: 'token-1',
    paidAt: null,
    paidMethod: null,
    paidValue: null,
    client: { name: 'Maria', email: 'maria@exemplo.com' },
    organization: {
      name: 'Raipp',
      logo: null,
      backgroundColor: null,
      buttonColor: null,
      contactEmail: 'contato@raipp.com',
      phone: null,
      mobilePhone: null,
      logoImage: null,
      notifyInvoiceIssued: true,
      notifyInvoiceReminder: true,
      invoiceReminderDays: 3,
      notifyInvoiceOverdue: true,
      notifyInvoicePaid: true,
    },
    charges: [
      {
        method: 'BANK_SLIP',
        status: 'PENDING',
        details: {
          bankSlipUrl: 'https://asaas.com/b/1',
          identificationField: '23793.38128',
        },
      },
    ],
    ...overrides,
  };
}

describe('InvoiceEmailsService', () => {
  let prisma: any;
  let outbox: any;
  let service: InvoiceEmailsService;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-18T12:00:00Z'));
    vi.stubEnv('FRONTEND_URL', 'https://app.fature.com.br');
    vi.stubEnv('EMAIL_FROM', 'cobrancas@mail.fature.com.br');

    prisma = {
      invoice: {
        findUnique: vi.fn().mockResolvedValue(buildInvoice()),
        findFirst: vi.fn().mockResolvedValue(buildInvoice()),
      },
    };
    outbox = {
      enqueue: vi.fn().mockResolvedValue({ id: 'log-1', status: 'SENT' }),
      recordSkipped: vi.fn().mockResolvedValue({ id: 'log-1' }),
      hasRecentManualSend: vi.fn().mockResolvedValue(false),
    };
    service = new InvoiceEmailsService(prisma, outbox);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  describe('sendAutomatic', () => {
    it('sends the issued invoice once, from the organization, with the Reply-To', async () => {
      await service.sendAutomatic('inv-1', EMAIL_TYPE.INVOICE_ISSUED, {
        deliverNow: true,
        today: TODAY,
      });

      const [input, options] = outbox.enqueue.mock.calls[0];

      expect(options).toEqual({ deliverNow: true });
      expect(input).toMatchObject({
        organizationId: 'org-1',
        clientId: 'client-1',
        invoiceId: 'inv-1',
        invoiceDraftId: null,
        type: 'INVOICE_ISSUED',
        source: EMAIL_SOURCE.AUTOMATIC,
        dedupeKey: 'invoice-issued:inv-1',
        recipient: 'maria@exemplo.com',
        sender: '"Raipp via Fature" <cobrancas@mail.fature.com.br>',
        replyTo: 'contato@raipp.com',
      });
      expect(input.content.text).toContain(
        'Ver fatura e pagar: https://app.fature.com.br/pagar/token-1',
      );
      expect(input.content.text).toContain('23793.38128');
      expect(input.content.text).toContain(
        'Pagando com PIX até 21/10/2026, o valor cai para R$ 95,00.',
      );
    });

    it('does nothing when the organization turned the email off', async () => {
      const invoice = buildInvoice();

      invoice.organization.notifyInvoiceIssued = false;
      prisma.invoice.findUnique.mockResolvedValue(invoice);

      await expect(
        service.sendAutomatic('inv-1', EMAIL_TYPE.INVOICE_ISSUED, {
          deliverNow: true,
          today: TODAY,
        }),
      ).resolves.toBeNull();
      expect(outbox.enqueue).not.toHaveBeenCalled();
      expect(outbox.recordSkipped).not.toHaveBeenCalled();
    });

    it('records the email as skipped when the client has no email', async () => {
      prisma.invoice.findUnique.mockResolvedValue(
        buildInvoice({ client: { name: 'Maria', email: null } }),
      );

      await service.sendAutomatic('inv-1', EMAIL_TYPE.INVOICE_ISSUED, {
        deliverNow: true,
        today: TODAY,
      });

      expect(outbox.enqueue).not.toHaveBeenCalled();
      expect(outbox.recordSkipped).toHaveBeenCalledWith(
        expect.objectContaining({
          dedupeKey: 'invoice-issued:inv-1',
          reason: 'Cliente sem e-mail cadastrado.',
        }),
      );
    });

    it('queues the reminder with the days until the due date', async () => {
      await service.sendAutomatic('inv-1', EMAIL_TYPE.INVOICE_REMINDER, {
        deliverNow: false,
        today: TODAY,
      });

      const [input, options] = outbox.enqueue.mock.calls[0];

      expect(options).toEqual({ deliverNow: false });
      expect(input.dedupeKey).toBe('invoice-reminder:inv-1:2026-10-21');
      expect(input.content.text).toContain('Sua fatura vence em 3 dias');
    });

    it('shows the amount with fine and interest on the overdue email', async () => {
      await service.sendAutomatic('inv-1', EMAIL_TYPE.INVOICE_OVERDUE, {
        deliverNow: false,
        today: '2026-10-22',
      });

      expect(outbox.enqueue.mock.calls[0][0].content.text).toContain(
        'Valor para pagar hoje (com multa e juros): R$ 102,03',
      );
    });

    it('links the receipt of the paid charge', async () => {
      prisma.invoice.findUnique.mockResolvedValue(
        buildInvoice({
          status: 'PAID',
          paidAt: new Date('2026-10-17T00:00:00Z'),
          paidMethod: 'PIX',
          paidValue: 95,
          charges: [
            { method: 'BANK_SLIP', status: 'CANCELLED', details: {} },
            {
              method: 'PIX',
              status: 'PAID',
              details: { receiptUrl: 'https://asaas.com/comprovantes/1' },
            },
          ],
        }),
      );

      await service.sendAutomatic('inv-1', EMAIL_TYPE.INVOICE_PAID, {
        deliverNow: true,
        today: TODAY,
      });

      const { content } = outbox.enqueue.mock.calls[0][0];

      expect(content.text).toContain(
        'Ver comprovante: https://asaas.com/comprovantes/1',
      );
      expect(content.text).toContain('Data do pagamento: 17/10/2026');
      expect(content.text).toContain('Forma de pagamento: PIX');
    });
  });

  describe('sendManual', () => {
    it('sends the template of the invoice status to the client email', async () => {
      prisma.invoice.findFirst.mockResolvedValue(
        buildInvoice({ dueDate: new Date('2026-10-10T00:00:00Z') }),
      );

      await service.sendManual('org-1', 'inv-1', {
        to: null,
        requestedBy: 'user-1',
      });

      expect(prisma.invoice.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inv-1', organizationId: 'org-1' },
        }),
      );
      expect(outbox.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'INVOICE_OVERDUE',
          source: EMAIL_SOURCE.MANUAL,
          requestedBy: 'user-1',
          dedupeKey: null,
          recipient: 'maria@exemplo.com',
        }),
        { deliverNow: true },
      );
    });

    it('sends to another address when informed', async () => {
      await service.sendManual('org-1', 'inv-1', {
        to: 'financeiro@cliente.com',
        requestedBy: null,
      });

      expect(outbox.enqueue.mock.calls[0][0].recipient).toBe(
        'financeiro@cliente.com',
      );
    });

    it('asks for a recipient when the client has no email', async () => {
      prisma.invoice.findFirst.mockResolvedValue(
        buildInvoice({ client: { name: 'Maria', email: null } }),
      );

      await expect(
        service.sendManual('org-1', 'inv-1', { to: null, requestedBy: null }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('refuses a cancelled invoice', async () => {
      prisma.invoice.findFirst.mockResolvedValue(
        buildInvoice({ status: 'CANCELLED' }),
      );

      await expect(
        service.sendManual('org-1', 'inv-1', { to: null, requestedBy: null }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('blocks repeated clicks', async () => {
      outbox.hasRecentManualSend.mockResolvedValue(true);

      const error = await service
        .sendManual('org-1', 'inv-1', { to: null, requestedBy: null })
        .catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });

    it('does not send invoices of another organization', async () => {
      prisma.invoice.findFirst.mockResolvedValue(null);

      await expect(
        service.sendManual('org-2', 'inv-1', { to: null, requestedBy: null }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('builds one dedupe key per invoice, and per due date for reminders', () => {
    const invoice = { id: 'inv-1', dueDate: new Date('2026-10-21T00:00:00Z') };

    expect(automaticDedupeKey('INVOICE_PAID', invoice)).toBe(
      'invoice-paid:inv-1',
    );
    expect(automaticDedupeKey('INVOICE_OVERDUE', invoice)).toBe(
      'invoice-overdue:inv-1:2026-10-21',
    );
  });

  it('reads the payment date in the billing timezone', () => {
    expect(paidDate(new Date('2026-10-17T00:00:00Z'))).toBe('2026-10-17');
    // 01:30 UTC ainda é dia 17 em São Paulo
    expect(paidDate(new Date('2026-10-18T01:30:00Z'))).toBe('2026-10-17');
  });
});
