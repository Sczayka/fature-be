import type { EmailMessage } from '../email.types.js';
import { EmailDeliveryError } from './email-transport.js';
import { ResendTransport, toDeliveryError } from './resend.transport.js';

const message: EmailMessage = {
  from: '"Raipp via Fature" <cobrancas@mail.fature.com.br>',
  to: 'cliente@exemplo.com',
  replyTo: 'contato@raipp.com',
  subject: 'Fatura',
  html: '<p>Fatura</p>',
  text: 'Fatura',
  tags: { type: 'INVOICE_ISSUED' },
};

describe('ResendTransport', () => {
  let send: ReturnType<typeof vi.fn>;
  let transport: ResendTransport;

  beforeEach(() => {
    send = vi.fn().mockResolvedValue({
      data: { id: 'msg-1' },
      error: null,
      headers: null,
    });
    transport = new ResendTransport({ emails: { send } } as any);
  });

  it('sends the message with the idempotency key', async () => {
    await expect(
      transport.send(message, { idempotencyKey: 'email-log/1' }),
    ).resolves.toEqual({ providerMessageId: 'msg-1' });

    expect(send).toHaveBeenCalledWith(
      {
        from: message.from,
        to: message.to,
        replyTo: message.replyTo,
        subject: 'Fatura',
        html: '<p>Fatura</p>',
        text: 'Fatura',
        tags: [{ name: 'type', value: 'INVOICE_ISSUED' }],
      },
      { idempotencyKey: 'email-log/1' },
    );
  });

  it('omits the Reply-To when there is none', async () => {
    await transport.send(
      { ...message, replyTo: null },
      { idempotencyKey: 'email-log/1' },
    );

    expect(send.mock.calls[0][0]).not.toHaveProperty('replyTo');
  });

  it('turns an error response into a delivery error', async () => {
    send.mockResolvedValue({
      data: null,
      error: {
        statusCode: 422,
        name: 'validation_error',
        message: 'Invalid `to` field.',
      },
      headers: null,
    });

    await expect(
      transport.send(message, { idempotencyKey: 'email-log/1' }),
    ).rejects.toMatchObject({ permanent: true });
  });

  it('treats a thrown error as temporary', async () => {
    send.mockRejectedValue(new Error('socket hang up'));

    const error = await transport
      .send(message, { idempotencyKey: 'email-log/1' })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect(error).toMatchObject({ permanent: false });
  });
});

describe('toDeliveryError', () => {
  it.each([
    [400, 'validation_error', true],
    [422, 'validation_error', true],
    [409, 'invalid_idempotent_request', true],
    [401, 'invalid_api_key', false],
    [403, 'validation_error', false],
    [429, 'rate_limit_exceeded', false],
    [500, 'internal_server_error', false],
    [null, 'application_error', false],
  ] as const)(
    'status %s (%s) is permanent: %s',
    (statusCode, name, permanent) => {
      expect(toDeliveryError({ statusCode, name, message: '' }).permanent).toBe(
        permanent,
      );
    },
  );
});
