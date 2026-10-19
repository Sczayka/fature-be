import { Prisma } from '@prisma/client';
import { EMAIL_SOURCE, EMAIL_STATUS, EMAIL_TYPE } from '../email.constants.js';
import type { EnqueueEmailInput } from '../email.types.js';
import { EmailDeliveryError } from '../transport/email-transport.js';
import { EmailOutboxService } from './email-outbox.service.js';

// PrismaService abre o pool do banco ao ser importado; os testes usam mocks
vi.mock('../../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
vi.mock('node:timers/promises', () => ({
  setTimeout: vi.fn().mockResolvedValue(undefined),
}));

const NOW = new Date('2026-10-18T12:00:00Z');

const input: EnqueueEmailInput = {
  organizationId: 'org-1',
  clientId: 'client-1',
  invoiceId: 'invoice-1',
  invoiceDraftId: null,
  type: EMAIL_TYPE.INVOICE_ISSUED,
  source: EMAIL_SOURCE.AUTOMATIC,
  requestedBy: null,
  dedupeKey: 'invoice-issued:invoice-1',
  recipient: 'cliente@exemplo.com',
  sender: '"Raipp via Fature" <cobrancas@mail.fature.com.br>',
  replyTo: null,
  content: { subject: 'Fatura', html: '<p>Fatura</p>', text: 'Fatura' },
};

function storedLog(overrides: Record<string, unknown> = {}) {
  return {
    id: 'log-1',
    organizationId: 'org-1',
    clientId: 'client-1',
    invoiceId: 'invoice-1',
    invoiceDraftId: null,
    type: EMAIL_TYPE.INVOICE_ISSUED,
    source: EMAIL_SOURCE.AUTOMATIC,
    requestedBy: null,
    recipient: 'cliente@exemplo.com',
    sender: input.sender,
    replyTo: null,
    subject: 'Fatura',
    html: '<p>Fatura</p>',
    text: 'Fatura',
    status: EMAIL_STATUS.SENDING,
    attempts: 1,
    nextAttemptAt: NOW,
    lastError: null,
    providerMessageId: null,
    sentAt: null,
    dedupeKey: 'invoice-issued:invoice-1',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('EmailOutboxService', () => {
  let prisma: any;
  let transport: any;
  let service: EmailOutboxService;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);

    prisma = {
      emailLog: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve(storedLog({ ...data })),
          ),
        update: vi
          .fn()
          .mockImplementation(({ where, data }) =>
            Promise.resolve({ id: where.id, ...data }),
          ),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      invoice: {
        findUnique: vi.fn().mockResolvedValue({ status: 'PENDING' }),
      },
    };
    transport = {
      name: 'test',
      send: vi.fn().mockResolvedValue({ providerMessageId: 'msg-1' }),
    };
    service = new EmailOutboxService(prisma, transport);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('enqueue', () => {
    it('stores the rendered email already claimed and sends it right away', async () => {
      await expect(
        service.enqueue(input, { deliverNow: true }),
      ).resolves.toMatchObject({ status: EMAIL_STATUS.SENT });

      expect(prisma.emailLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: EMAIL_STATUS.SENDING,
          attempts: 1,
          subject: 'Fatura',
          html: '<p>Fatura</p>',
          dedupeKey: 'invoice-issued:invoice-1',
        }),
      });
      expect(transport.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'cliente@exemplo.com',
          replyTo: null,
          tags: { type: EMAIL_TYPE.INVOICE_ISSUED },
        }),
        { idempotencyKey: 'email-log/log-1' },
      );
      expect(prisma.emailLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: EMAIL_STATUS.SENT,
            sentAt: NOW,
            providerMessageId: 'msg-1',
          }),
        }),
      );
    });

    it('queues the email for the worker without sending it', async () => {
      await expect(
        service.enqueue(input, { deliverNow: false }),
      ).resolves.toMatchObject({ status: EMAIL_STATUS.QUEUED });

      expect(prisma.emailLog.create.mock.calls[0][0].data).toMatchObject({
        attempts: 0,
        nextAttemptAt: NOW,
      });
      expect(transport.send).not.toHaveBeenCalled();
    });

    it('skips an automatic notice that was already registered', async () => {
      prisma.emailLog.findUnique.mockResolvedValue({ id: 'log-0' });

      await expect(
        service.enqueue(input, { deliverNow: true }),
      ).resolves.toBeNull();

      expect(prisma.emailLog.create).not.toHaveBeenCalled();
      expect(transport.send).not.toHaveBeenCalled();
    });

    it('skips the notice when another process stored it first', async () => {
      prisma.emailLog.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.enqueue(input, { deliverNow: true }),
      ).resolves.toBeNull();
      expect(transport.send).not.toHaveBeenCalled();
    });

    it('schedules a new attempt after a temporary failure', async () => {
      transport.send.mockRejectedValue(
        new EmailDeliveryError('Provedor de e-mail indisponível.', false),
      );

      await expect(
        service.enqueue(input, { deliverNow: true }),
      ).resolves.toMatchObject({
        status: EMAIL_STATUS.RETRYING,
        lastError: 'Provedor de e-mail indisponível.',
        nextAttemptAt: new Date(NOW.getTime() + 60_000),
      });
    });

    it('gives up on a permanent failure', async () => {
      transport.send.mockRejectedValue(
        new EmailDeliveryError('E-mail recusado.', true),
      );

      await expect(
        service.enqueue(input, { deliverNow: true }),
      ).resolves.toMatchObject({ status: EMAIL_STATUS.FAILED });
    });

    it('skips an open-invoice notice when the invoice was paid meanwhile', async () => {
      prisma.invoice.findUnique.mockResolvedValue({ status: 'PAID' });

      await expect(
        service.enqueue(input, { deliverNow: true }),
      ).resolves.toMatchObject({
        status: EMAIL_STATUS.SKIPPED,
        lastError: 'Fatura paga antes do envio.',
      });
      expect(transport.send).not.toHaveBeenCalled();
    });

    it('sends manual emails even for paid invoices', async () => {
      prisma.invoice.findUnique.mockResolvedValue({ status: 'PAID' });

      await expect(
        service.enqueue(
          { ...input, source: EMAIL_SOURCE.MANUAL, dedupeKey: null },
          { deliverNow: true },
        ),
      ).resolves.toMatchObject({ status: EMAIL_STATUS.SENT });
    });
  });

  it('records a skipped email without a recipient', async () => {
    await service.recordSkipped({
      ...input,
      subject: 'Fatura',
      reason: 'Cliente sem e-mail cadastrado',
    });

    expect(prisma.emailLog.create.mock.calls[0][0].data).toMatchObject({
      recipient: null,
      status: EMAIL_STATUS.SKIPPED,
      lastError: 'Cliente sem e-mail cadastrado',
    });
    expect(transport.send).not.toHaveBeenCalled();
  });

  describe('processDue', () => {
    beforeEach(() => {
      prisma.emailLog.findMany.mockResolvedValue([
        { id: 'log-1' },
        { id: 'log-2' },
      ]);
      prisma.emailLog.findUnique.mockImplementation(({ where }: any) =>
        Promise.resolve(storedLog({ id: where.id, attempts: 2 })),
      );
    });

    it('claims and sends the due emails', async () => {
      await expect(service.processDue()).resolves.toBe(2);

      expect(prisma.emailLog.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'log-1',
          status: { in: ['QUEUED', 'RETRYING', 'SENDING'] },
          nextAttemptAt: { lte: NOW },
        },
        data: {
          status: EMAIL_STATUS.SENDING,
          attempts: { increment: 1 },
          nextAttemptAt: new Date(NOW.getTime() + 5 * 60_000),
        },
      });
      expect(transport.send).toHaveBeenCalledTimes(2);
    });

    it('leaves an email claimed by another instance alone', async () => {
      prisma.emailLog.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });

      await expect(service.processDue()).resolves.toBe(1);
      expect(transport.send).toHaveBeenCalledTimes(1);
    });

    it('fails the email on the last attempt', async () => {
      prisma.emailLog.findMany.mockResolvedValue([{ id: 'log-1' }]);
      prisma.emailLog.findUnique.mockResolvedValue(storedLog({ attempts: 5 }));
      transport.send.mockRejectedValue(new Error('boom'));

      await service.processDue();

      expect(prisma.emailLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            status: EMAIL_STATUS.FAILED,
            lastError: 'Falha inesperada no envio.',
          },
        }),
      );
    });
  });

  it('detects a recent manual send', async () => {
    prisma.emailLog.findFirst.mockResolvedValue({ id: 'log-1' });

    await expect(
      service.hasRecentManualSend({ invoiceId: 'invoice-1' }),
    ).resolves.toBe(true);
    expect(prisma.emailLog.findFirst).toHaveBeenCalledWith({
      where: {
        invoiceId: 'invoice-1',
        source: EMAIL_SOURCE.MANUAL,
        createdAt: { gt: new Date(NOW.getTime() - 60_000) },
      },
      select: { id: true },
    });
  });

  it('purges the body of finished emails', async () => {
    prisma.emailLog.updateMany.mockResolvedValue({ count: 3 });

    await expect(service.purgeBodies(NOW)).resolves.toBe(3);
    expect(prisma.emailLog.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { html: null, text: null } }),
    );
  });
});
