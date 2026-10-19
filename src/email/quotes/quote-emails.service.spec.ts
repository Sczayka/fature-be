import {
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { QuoteEmailsService } from './quote-emails.service.js';

// PrismaService abre o pool do banco ao ser importado; os testes usam mocks
vi.mock('../../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

function buildDraft(overrides: Record<string, unknown> = {}) {
  return {
    client: { id: 'client-1', name: 'Maria', email: 'maria@exemplo.com' },
    items: [
      {
        item: { id: 'item-1', name: 'Site', type: 'service', price: 1000 },
        quantity: 1,
        total: 1000,
      },
      {
        item: { id: 'item-2', name: 'Hospedagem', type: 'service', price: 50 },
        quantity: 2,
        total: 100,
      },
    ],
    billing: { dueDate: '2026-11-10', description: 'Projeto do site' },
    discount: {
      items: [{ id: 'item-1', type: 'PERCENTAGE', value: 10 }],
      methods: [],
    },
    interestAndFine: null,
    organization: {
      name: 'Raipp',
      logo: null,
      backgroundColor: null,
      buttonColor: null,
      contactEmail: null,
      phone: null,
      mobilePhone: null,
      logoImage: null,
    },
    ...overrides,
  };
}

describe('QuoteEmailsService', () => {
  let prisma: any;
  let outbox: any;
  let service: QuoteEmailsService;

  beforeEach(() => {
    vi.stubEnv('EMAIL_FROM', 'cobrancas@mail.fature.com.br');

    prisma = {
      invoiceDraft: { findFirst: vi.fn().mockResolvedValue(buildDraft()) },
      client: { findFirst: vi.fn().mockResolvedValue({ id: 'client-1' }) },
    };
    outbox = {
      enqueue: vi.fn().mockResolvedValue({ id: 'log-1', status: 'SENT' }),
      hasRecentManualSend: vi.fn().mockResolvedValue(false),
    };
    service = new QuoteEmailsService(prisma, outbox);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sends the quote with the totals to the client of the draft', async () => {
    await service.send('org-1', 'draft-1', { to: null, requestedBy: 'user-1' });

    const [input, options] = outbox.enqueue.mock.calls[0];

    expect(options).toEqual({ deliverNow: true });
    expect(input).toMatchObject({
      organizationId: 'org-1',
      clientId: 'client-1',
      invoiceId: null,
      invoiceDraftId: 'draft-1',
      type: 'QUOTE',
      source: 'MANUAL',
      requestedBy: 'user-1',
      dedupeKey: null,
      recipient: 'maria@exemplo.com',
      replyTo: null,
    });
    expect(input.content.subject).toBe('Orçamento de Raipp');
    expect(input.content.text).toContain('Subtotal: R$ 1.100,00');
    expect(input.content.text).toContain('Descontos: - R$ 100,00');
    expect(input.content.text).toContain('Total: R$ 1.000,00');
    expect(input.content.text).toContain('Vencimento previsto: 10/11/2026');
    expect(prisma.client.findFirst).toHaveBeenCalledWith({
      where: { id: 'client-1', organizationId: 'org-1' },
      select: { id: true },
    });
  });

  it('does not link a client of another organization', async () => {
    prisma.client.findFirst.mockResolvedValue(null);

    await service.send('org-1', 'draft-1', { to: null, requestedBy: null });

    expect(outbox.enqueue.mock.calls[0][0].clientId).toBeNull();
  });

  it('sends a draft of an unregistered client to the informed address', async () => {
    prisma.invoiceDraft.findFirst.mockResolvedValue(
      buildDraft({ client: { name: 'Novo cliente' } }),
    );

    await service.send('org-1', 'draft-1', {
      to: 'novo@cliente.com',
      requestedBy: null,
    });

    expect(prisma.client.findFirst).not.toHaveBeenCalled();
    expect(outbox.enqueue.mock.calls[0][0]).toMatchObject({
      clientId: null,
      recipient: 'novo@cliente.com',
    });
  });

  it('asks for a recipient when the draft has no client email', async () => {
    prisma.invoiceDraft.findFirst.mockResolvedValue(
      buildDraft({ client: null }),
    );

    await expect(
      service.send('org-1', 'draft-1', { to: null, requestedBy: null }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('refuses a draft without items', async () => {
    prisma.invoiceDraft.findFirst.mockResolvedValue(buildDraft({ items: [] }));

    await expect(
      service.send('org-1', 'draft-1', { to: null, requestedBy: null }),
    ).rejects.toThrow('Adicione itens ao orçamento antes de enviar.');
  });

  it('blocks repeated clicks', async () => {
    outbox.hasRecentManualSend.mockResolvedValue(true);

    const error = await service
      .send('org-1', 'draft-1', { to: null, requestedBy: null })
      .catch((reason: unknown) => reason);

    expect((error as HttpException).getStatus()).toBe(429);
    expect(outbox.hasRecentManualSend).toHaveBeenCalledWith({
      invoiceDraftId: 'draft-1',
    });
  });

  it('does not send drafts of another organization', async () => {
    prisma.invoiceDraft.findFirst.mockResolvedValue(null);

    await expect(
      service.send('org-2', 'draft-1', { to: null, requestedBy: null }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
