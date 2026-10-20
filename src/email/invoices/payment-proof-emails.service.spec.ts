import { Prisma } from '@prisma/client';
import { PaymentProofEmailsService } from './payment-proof-emails.service.js';

// PrismaService abre o pool do banco ao ser importado; os testes usam mocks
vi.mock('../../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

const EVENT = {
  invoiceId: 'inv-1',
  organizationId: 'org-1',
  transactionId: 'tx-proof',
};

function proof(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx-proof',
    type: 'PAYMENT',
    status: 'PENDING_REVIEW',
    source: 'CHECKOUT',
    method: 'BANK_TRANSFER',
    amount: null,
    occurredAt: null,
    createdAt: new Date('2026-10-18T12:00:00Z'),
    chargeId: null,
    statusReason: null,
    ...overrides,
  };
}

/** Fatura de 500 sem desconto, vencimento em 30/10. */
function buildInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    organizationId: 'org-1',
    clientId: 'client-1',
    items: [{ id: 'item-1', total: 500 }],
    dueDate: new Date('2026-10-30T00:00:00Z'),
    description: 'Mensalidade',
    discount: null,
    interestAndFine: null,
    checkoutToken: 'token-1',
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
      notifyPaymentProofReceived: true,
      notifyPaymentProofRejected: true,
      notifyPartialPayment: true,
    },
    transactions: [proof()],
    ...overrides,
  };
}

describe('PaymentProofEmailsService', () => {
  let prisma: any;
  let outbox: any;
  let service: PaymentProofEmailsService;

  const withOrganization = (organization: Record<string, unknown>) =>
    prisma.invoice.findUnique.mockResolvedValue(
      buildInvoice({
        organization: { ...buildInvoice().organization, ...organization },
      }),
    );

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-18T12:00:00Z'));
    vi.stubEnv('FRONTEND_URL', 'https://app.fature.com.br');
    vi.stubEnv('EMAIL_FROM', 'cobrancas@mail.fature.com.br');

    prisma = {
      invoice: { findUnique: vi.fn().mockResolvedValue(buildInvoice()) },
      member: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ user: { email: 'dono@raipp.com' } }),
      },
    };
    outbox = {
      enqueue: vi.fn().mockResolvedValue({ id: 'log-1', status: 'SENT' }),
      recordSkipped: vi.fn().mockResolvedValue({ id: 'log-1' }),
    };
    service = new PaymentProofEmailsService(prisma, outbox);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  describe('sendReceived', () => {
    it('warns the company at the contact email, outside the history of the client', async () => {
      await service.sendReceived(EVENT);

      const [input, options] = outbox.enqueue.mock.calls[0];

      expect(options).toEqual({ deliverNow: true });
      expect(input).toMatchObject({
        organizationId: 'org-1',
        clientId: null,
        invoiceId: 'inv-1',
        type: 'PAYMENT_PROOF_RECEIVED',
        source: 'AUTOMATIC',
        dedupeKey: 'payment-proof-received:tx-proof',
        recipient: 'contato@raipp.com',
        sender: '"Fature" <cobrancas@mail.fature.com.br>',
        replyTo: null,
      });
      expect(input.content.subject).toBe(
        'Comprovante recebido: fatura de Maria',
      );
      expect(input.content.text).toContain('Valor da fatura hoje: R$ 500,00');
      expect(input.content.text).toContain(
        'Conferir comprovante: https://app.fature.com.br/faturas/inv-1',
      );
      expect(prisma.member.findFirst).not.toHaveBeenCalled();
    });

    it('falls back to the owner of the organization without a contact email', async () => {
      withOrganization({ contactEmail: null });

      await service.sendReceived(EVENT);

      expect(prisma.member.findFirst).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', role: 'owner' },
        orderBy: { createdAt: 'asc' },
        select: { user: { select: { email: true } } },
      });
      expect(outbox.enqueue.mock.calls[0][0].recipient).toBe('dono@raipp.com');
    });

    it('only logs when there is nobody to warn', async () => {
      withOrganization({ contactEmail: null });
      prisma.member.findFirst.mockResolvedValue(null);

      await expect(service.sendReceived(EVENT)).resolves.toBeNull();
      expect(outbox.enqueue).not.toHaveBeenCalled();
      expect(outbox.recordSkipped).not.toHaveBeenCalled();
    });

    it('does nothing when the organization turned the warning off', async () => {
      withOrganization({ notifyPaymentProofReceived: false });

      await expect(service.sendReceived(EVENT)).resolves.toBeNull();
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });

    it('does nothing when the proof was removed in the meantime', async () => {
      prisma.invoice.findUnique.mockResolvedValue(
        buildInvoice({ transactions: [] }),
      );

      await expect(service.sendReceived(EVENT)).resolves.toBeNull();
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('sendRejected', () => {
    beforeEach(() => {
      prisma.invoice.findUnique.mockResolvedValue(
        buildInvoice({
          transactions: [
            proof({ status: 'REJECTED', statusReason: 'Comprovante ilegível' }),
          ],
        }),
      );
    });

    it('sends the reason to the payer once per proof', async () => {
      await service.sendRejected(EVENT);

      const [input] = outbox.enqueue.mock.calls[0];

      expect(input).toMatchObject({
        clientId: 'client-1',
        type: 'PAYMENT_PROOF_REJECTED',
        dedupeKey: 'payment-proof-rejected:tx-proof',
        recipient: 'maria@exemplo.com',
        sender: '"Raipp via Fature" <cobrancas@mail.fature.com.br>',
        replyTo: 'contato@raipp.com',
      });
      expect(input.content.text).toContain('Motivo: Comprovante ilegível');
      expect(input.content.text).toContain(
        'Enviar outro comprovante: https://app.fature.com.br/pagar/token-1',
      );
    });

    it('records the email as skipped when the client has no email', async () => {
      prisma.invoice.findUnique.mockResolvedValue(
        buildInvoice({
          client: { name: 'Maria', email: null },
          transactions: [
            proof({ status: 'REJECTED', statusReason: 'Ilegível' }),
          ],
        }),
      );

      await service.sendRejected(EVENT);

      expect(outbox.enqueue).not.toHaveBeenCalled();
      expect(outbox.recordSkipped).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'client-1',
          type: 'PAYMENT_PROOF_REJECTED',
          dedupeKey: 'payment-proof-rejected:tx-proof',
          reason: 'Cliente sem e-mail cadastrado.',
        }),
      );
    });

    it('does nothing when the organization turned the warning off', async () => {
      withOrganization({ notifyPaymentProofRejected: false });

      await expect(service.sendRejected(EVENT)).resolves.toBeNull();
      expect(outbox.recordSkipped).not.toHaveBeenCalled();
    });
  });

  describe('sendPartiallyPaid', () => {
    it('sends what was received and the balance of today', async () => {
      prisma.invoice.findUnique.mockResolvedValue(
        buildInvoice({
          transactions: [
            proof({
              id: 'tx-first',
              status: 'CONFIRMED',
              source: 'OPERATOR',
              amount: new Prisma.Decimal(100),
              occurredAt: new Date('2026-10-16T00:00:00Z'),
              createdAt: new Date('2026-10-16T12:00:00Z'),
            }),
            proof({
              status: 'CONFIRMED',
              amount: new Prisma.Decimal(300),
              occurredAt: new Date('2026-10-17T00:00:00Z'),
            }),
          ],
        }),
      );

      await service.sendPartiallyPaid(EVENT);

      const [input] = outbox.enqueue.mock.calls[0];

      expect(input).toMatchObject({
        type: 'INVOICE_PARTIALLY_PAID',
        dedupeKey: 'invoice-partially-paid:tx-proof',
        recipient: 'maria@exemplo.com',
      });
      expect(input.content.text).toContain('Valor recebido: R$ 300,00');
      expect(input.content.text).toContain('Total recebido: R$ 400,00');
      expect(input.content.text).toContain('Falta pagar hoje: R$ 100,00');
    });

    it('does nothing when the organization turned the warning off', async () => {
      withOrganization({ notifyPartialPayment: false });

      await expect(service.sendPartiallyPaid(EVENT)).resolves.toBeNull();
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });
  });
});
