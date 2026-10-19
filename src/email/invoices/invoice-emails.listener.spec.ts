import { InvoiceEmailsListener } from './invoice-emails.listener.js';

// PrismaService abre o pool do banco ao ser importado; os testes usam mocks
vi.mock('../../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

describe('InvoiceEmailsListener', () => {
  let invoiceEmails: any;
  let listener: InvoiceEmailsListener;

  beforeEach(() => {
    invoiceEmails = { sendAutomatic: vi.fn().mockResolvedValue(null) };
    listener = new InvoiceEmailsListener(invoiceEmails);
  });

  it('sends the issued invoice right away', async () => {
    await listener.onInvoiceIssued({
      invoiceId: 'inv-1',
      organizationId: 'org-1',
    });

    expect(invoiceEmails.sendAutomatic).toHaveBeenCalledWith(
      'inv-1',
      'INVOICE_ISSUED',
      { deliverNow: true, today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
    );
  });

  it('sends the payment confirmation right away', async () => {
    await listener.onInvoicePaid({
      invoiceId: 'inv-1',
      organizationId: 'org-1',
      chargeId: 'charge-1',
      method: 'PIX',
      paidAt: '2026-10-18T12:00:00.000Z',
      paidValue: 95,
    });

    expect(invoiceEmails.sendAutomatic.mock.calls[0][1]).toBe('INVOICE_PAID');
  });

  it('does not let a failure escape the event handler', async () => {
    invoiceEmails.sendAutomatic.mockRejectedValue(new Error('db down'));

    await expect(
      listener.onInvoiceIssued({ invoiceId: 'inv-1', organizationId: 'org-1' }),
    ).resolves.toBeUndefined();
  });
});
