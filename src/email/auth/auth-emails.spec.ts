import { setTimeout as sleep } from 'node:timers/promises';
import { EmailDeliveryError } from '../transport/email-transport.js';
import { deliverAuthEmail } from './auth-emails.js';

vi.mock('node:timers/promises', () => ({
  setTimeout: vi.fn().mockResolvedValue(undefined),
}));

const content = {
  subject: 'Redefinição de senha do Fature',
  html: '<p>Link</p>',
  text: 'Link',
};

describe('deliverAuthEmail', () => {
  let transport: any;

  beforeEach(() => {
    vi.stubEnv('EMAIL_FROM', 'nao-responda@mail.fature.com.br');
    vi.mocked(sleep).mockClear();
    transport = {
      name: 'test',
      send: vi.fn().mockResolvedValue({ providerMessageId: 'msg-1' }),
    };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sends from the Fature address', async () => {
    await expect(
      deliverAuthEmail('ana@exemplo.com', content, null, transport),
    ).resolves.toBe(true);

    expect(transport.send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '"Fature" <nao-responda@mail.fature.com.br>',
        to: 'ana@exemplo.com',
        replyTo: null,
        subject: content.subject,
      }),
      { idempotencyKey: expect.stringMatching(/^auth-email\//) },
    );
  });

  it('retries temporary failures with the same idempotency key', async () => {
    transport.send
      .mockRejectedValueOnce(new EmailDeliveryError('indisponível', false))
      .mockResolvedValueOnce({ providerMessageId: 'msg-1' });

    await expect(
      deliverAuthEmail('ana@exemplo.com', content, null, transport),
    ).resolves.toBe(true);

    const [first, second] = transport.send.mock.calls;

    expect(second[1].idempotencyKey).toBe(first[1].idempotencyKey);
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it('gives up without throwing', async () => {
    transport.send.mockRejectedValue(new Error('boom'));

    await expect(
      deliverAuthEmail('ana@exemplo.com', content, null, transport),
    ).resolves.toBe(false);
    expect(transport.send).toHaveBeenCalledTimes(3);
  });

  it('does not retry a permanent failure', async () => {
    transport.send.mockRejectedValue(new EmailDeliveryError('recusado', true));

    await expect(
      deliverAuthEmail('ana@exemplo.com', content, null, transport),
    ).resolves.toBe(false);
    expect(transport.send).toHaveBeenCalledTimes(1);
  });
});
