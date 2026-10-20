import { PaymentProofEmailsListener } from './payment-proof-emails.listener.js';

// PrismaService abre o pool do banco ao ser importado; os testes usam mocks
vi.mock('../../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

const EVENT = {
  invoiceId: 'inv-1',
  organizationId: 'org-1',
  transactionId: 'tx-1',
};

describe('PaymentProofEmailsListener', () => {
  let emails: any;
  let listener: PaymentProofEmailsListener;

  beforeEach(() => {
    emails = {
      sendReceived: vi.fn().mockResolvedValue(null),
      sendRejected: vi.fn().mockResolvedValue(null),
      sendPartiallyPaid: vi.fn().mockResolvedValue(null),
    };
    listener = new PaymentProofEmailsListener(emails);
  });

  it('sends each warning of the manual payment', async () => {
    await listener.onProofReceived(EVENT);
    await listener.onProofRejected(EVENT);
    await listener.onPartiallyPaid(EVENT);

    expect(emails.sendReceived).toHaveBeenCalledWith(EVENT);
    expect(emails.sendRejected).toHaveBeenCalledWith(EVENT);
    expect(emails.sendPartiallyPaid).toHaveBeenCalledWith(EVENT);
  });

  it('does not let a failure escape the event handler', async () => {
    emails.sendRejected.mockRejectedValue(new Error('db down'));

    await expect(listener.onProofRejected(EVENT)).resolves.toBeUndefined();
  });
});
